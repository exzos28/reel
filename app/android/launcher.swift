// reel's art in Android's launchers, as vector drawables (no raster at any density), from the app
// icon's design (design/icon): "reel" in Geist Bold in reel's red on the icon's dark gradient.
// The letters are drawn as shapes: a launcher cannot use the app's fonts.
//
// - drawable/banner: Android TV's banner (`android:banner`, 320 × 180 dp), the icon's tile made
//   wide;
// - mipmap/icon: the adaptive icon (`android:icon`, `android:roundIcon`): drawable/icon_background
//   (the gradient) and drawable/icon_foreground (the word; also the themed icon's monochrome
//   layer), so each launcher cuts it to its own shape (circle, squircle…) instead of shrinking a
//   square into a white circle. 108 × 108 dp layers, of which a launcher shows the middle 72.
//
//   swift app/android/launcher.swift app/fonts/Geist.ttf app/android/res
import CoreGraphics
import CoreText
import Foundation

let args = CommandLine.arguments
let fontURL = URL(fileURLWithPath: args[1]) as CFURL
let res = URL(fileURLWithPath: args[2])
guard let descs = CTFontManagerCreateFontDescriptorsFromURL(fontURL) as? [CTFontDescriptor], let desc = descs.first else { fatalError("no font") }
// Bold: the variable font's weight axis at 700.
let wght: UInt32 = 0x7767_6874
let bold = CTFontDescriptorCreateCopyWithAttributes(desc, [kCTFontVariationAttribute: [wght: 700]] as CFDictionary)

/// The word's outline at `size`, on a baseline at y = 0 (CoreText's y up).
func word(size: CGFloat) -> CGPath {
    let font = CTFontCreateWithFontDescriptor(bold, size, nil)
    let text = NSAttributedString(string: "reel", attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTKernAttributeName as String): -0.025 * size,
    ])
    let path = CGMutablePath()
    for run in CTLineGetGlyphRuns(CTLineCreateWithAttributedString(text)) as! [CTRun] {
        let n = CTRunGetGlyphCount(run)
        var glyphs = [CGGlyph](repeating: 0, count: n)
        var positions = [CGPoint](repeating: .zero, count: n)
        CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
        CTRunGetPositions(run, CFRange(location: 0, length: n), &positions)
        for i in 0..<n {
            var at = CGAffineTransform(translationX: positions[i].x, y: positions[i].y)
            if let glyph = CTFontCreatePathForGlyph(font, glyphs[i], &at) { path.addPath(glyph) }
        }
    }
    return path
}

func n(_ v: CGFloat) -> String {
    let r = (v * 100).rounded() / 100
    return r == r.rounded() ? String(Int(r)) : String(format: "%.2f", r).replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
}

/// The word's path data, centred on the letters' own bounds in `tile` and raised by `lift` (the
/// icon centres its word the same way, a little high); y down.
func wordData(size: CGFloat, tile: CGRect, lift: CGFloat) -> String {
    let path = word(size: size)
    let bounds = path.boundingBoxOfPath
    let dx = tile.minX + (tile.width - bounds.width) / 2 - bounds.minX
    let baseline = tile.minY + (tile.height + bounds.height) / 2 + bounds.minY - lift
    func p(_ pt: CGPoint) -> String { "\(n(pt.x + dx)),\(n(baseline - pt.y))" }
    var d = ""
    path.applyWithBlock { e in
        let pts = e.pointee.points
        switch e.pointee.type {
        case .moveToPoint: d += "M\(p(pts[0]))"
        case .addLineToPoint: d += "L\(p(pts[0]))"
        case .addQuadCurveToPoint: d += "Q\(p(pts[0])) \(p(pts[1]))"
        case .addCurveToPoint: d += "C\(p(pts[0])) \(p(pts[1])) \(p(pts[2]))"
        case .closeSubpath: d += "Z"
        @unknown default: fatalError("path element")
        }
    }
    return d
}

/// The icon's background over a `width` × `height` viewport, laid out for `tile`:
/// radial-gradient(120% 90% at 30% 20%, #26313A, #161B20 55%, #0F0F0F). A vector's radial
/// gradient is a circle: drawn in a group squeezed to the ellipse's proportions.
func background(width: CGFloat, height: CGFloat, tile: CGRect) -> String {
    let (rx, ry) = (1.2 * tile.width, 0.9 * tile.height)
    let squeeze = ry / rx
    return """
        <group android:scaleY="\(String(format: "%.6f", squeeze))">
            <path android:pathData="M0,0H\(n(width))V\(n(height / squeeze))H0Z">
                <aapt:attr name="android:fillColor">
                    <gradient
                        android:type="radial"
                        android:centerX="\(n(tile.minX + 0.3 * tile.width))"
                        android:centerY="\(n((tile.minY + 0.2 * tile.height) / squeeze))"
                        android:gradientRadius="\(n(rx))">
                        <item android:offset="0" android:color="#FF26313A" />
                        <item android:offset="0.55" android:color="#FF161B20" />
                        <item android:offset="1" android:color="#FF0F0F0F" />
                    </gradient>
                </aapt:attr>
            </path>
        </group>
    """
}

func vector(_ what: String, width: CGFloat, height: CGFloat, _ body: String) -> String {
    """
    <?xml version="1.0" encoding="utf-8"?>
    <!-- Made by app/android/launcher.swift: \(what). -->
    <vector xmlns:android="http://schemas.android.com/apk/res/android"
        xmlns:aapt="http://schemas.android.com/aapt"
        android:width="\(n(width))dp"
        android:height="\(n(height))dp"
        android:viewportWidth="\(n(width))"
        android:viewportHeight="\(n(height))">
    \(body)
    </vector>

    """
}

func red(_ d: String) -> String {
    """
        <path
            android:fillColor="#FFE5383B"
            android:pathData="\(d)" />
    """
}

func write(_ text: String, _ file: String) {
    let url = res.appendingPathComponent(file)
    try! FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try! text.write(to: url, atomically: true, encoding: .utf8)
    print(url.path)
}

// The banner: the word larger than the icon's (36 % of its height) for the distance a TV is
// watched from, still well inside the launcher's rounded, zoomed frame.
let banner = CGRect(x: 0, y: 0, width: 320, height: 180)
write(vector("the Android TV banner", width: banner.width, height: banner.height,
             background(width: banner.width, height: banner.height, tile: banner) + "\n"
                 + red(wordData(size: 84, tile: banner, lift: 4))),
      "drawable/banner.xml")

// The adaptive icon: the launcher shows the middle 72 of 108 dp, laid out as the full icon
// (design/icon/icon-full.html: the word at 372 px of 1024, raised 2 %).
let canvas: CGFloat = 108
let tile = CGRect(x: 18, y: 18, width: 72, height: 72)
write(vector("the adaptive icon's background", width: canvas, height: canvas,
             background(width: canvas, height: canvas, tile: tile)),
      "drawable/icon_background.xml")
write(vector("the adaptive icon's word", width: canvas, height: canvas,
             red(wordData(size: 372.0 / 1024 * tile.width, tile: tile, lift: 0.02 * tile.height))),
      "drawable/icon_foreground.xml")
write("""
    <?xml version="1.0" encoding="utf-8"?>
    <!-- Made by app/android/launcher.swift: the launcher icon, cut to each launcher's shape. -->
    <adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
        <background android:drawable="@drawable/icon_background" />
        <foreground android:drawable="@drawable/icon_foreground" />
        <monochrome android:drawable="@drawable/icon_foreground" />
    </adaptive-icon>

    """, "mipmap-anydpi-v26/icon.xml")
