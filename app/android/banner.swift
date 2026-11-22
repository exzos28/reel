// The Android TV banner (`android:banner`, 320 × 180 dp): the app icon's tile (design/icon) made
// wide, "reel" in Geist Bold in reel's red on the icon's dark gradient, as a vector drawable, so
// no raster is needed at any density. The letters are drawn as shapes: a banner cannot use the
// app's fonts.
//
//   swift app/android/banner.swift app/fonts/Geist.ttf app/android/res/drawable/banner.xml
import CoreGraphics
import CoreText
import Foundation

let args = CommandLine.arguments
let fontURL = URL(fileURLWithPath: args[1]) as CFURL
let out = URL(fileURLWithPath: args[2])
let (width, height): (CGFloat, CGFloat) = (320, 180)
// The icon's word is 36 % of its height (372 px of 1024); the banner's is larger for the
// distance a TV is watched from, still well inside the launcher's rounded, zoomed frame.
let size: CGFloat = 84
let tracking: CGFloat = -0.025 * size
guard let descs = CTFontManagerCreateFontDescriptorsFromURL(fontURL) as? [CTFontDescriptor], let desc = descs.first else { fatalError("no font") }
// Bold: the variable font's weight axis at 700.
let wght: UInt32 = 0x7767_6874
let bold = CTFontDescriptorCreateCopyWithAttributes(desc, [kCTFontVariationAttribute: [wght: 700]] as CFDictionary)
let font = CTFontCreateWithFontDescriptor(bold, size, nil)

let text = NSAttributedString(string: "reel", attributes: [
    NSAttributedString.Key(kCTFontAttributeName as String): font,
    NSAttributedString.Key(kCTKernAttributeName as String): tracking,
])
let line = CTLineCreateWithAttributedString(text)

// The word's outline, on a baseline at y = 0 (CoreText's y up).
let word = CGMutablePath()
for run in CTLineGetGlyphRuns(line) as! [CTRun] {
    let n = CTRunGetGlyphCount(run)
    var glyphs = [CGGlyph](repeating: 0, count: n)
    var positions = [CGPoint](repeating: .zero, count: n)
    CTRunGetGlyphs(run, CFRange(location: 0, length: n), &glyphs)
    CTRunGetPositions(run, CFRange(location: 0, length: n), &positions)
    for i in 0..<n {
        var at = CGAffineTransform(translationX: positions[i].x, y: positions[i].y)
        if let glyph = CTFontCreatePathForGlyph(font, glyphs[i], &at) { word.addPath(glyph) }
    }
}
// Centred on the letters' own bounds (the icon centres its word the same way, a little high).
let bounds = word.boundingBoxOfPath
let dx = (width - bounds.width) / 2 - bounds.minX
let baseline = (height + bounds.height) / 2 + bounds.minY - 4 // y down from here on

func n(_ v: CGFloat) -> String {
    let r = (v * 100).rounded() / 100
    return r == r.rounded() ? String(Int(r)) : String(format: "%.2f", r).replacingOccurrences(of: #"0+$"#, with: "", options: .regularExpression)
}
func p(_ pt: CGPoint) -> String { "\(n(pt.x + dx)),\(n(baseline - pt.y))" }

var d = ""
word.applyWithBlock { e in
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

// The icon's background: radial-gradient(120% 90% at 30% 20%, #26313A, #161B20 55%, #0F0F0F).
// A vector's radial gradient is a circle: drawn in a group squeezed to the ellipse's proportions.
let (rx, ry) = (1.2 * width, 0.9 * height)
let squeeze = ry / rx
let xml = """
<?xml version="1.0" encoding="utf-8"?>
<!-- Made by app/android/banner.swift: the Android TV banner. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:aapt="http://schemas.android.com/aapt"
    android:width="\(n(width))dp"
    android:height="\(n(height))dp"
    android:viewportWidth="\(n(width))"
    android:viewportHeight="\(n(height))">
    <group android:scaleY="\(String(format: "%.6f", squeeze))">
        <path android:pathData="M0,0H\(n(width))V\(n(height / squeeze))H0Z">
            <aapt:attr name="android:fillColor">
                <gradient
                    android:type="radial"
                    android:centerX="\(n(0.3 * width))"
                    android:centerY="\(n(0.2 * height / squeeze))"
                    android:gradientRadius="\(n(rx))">
                    <item android:offset="0" android:color="#FF26313A" />
                    <item android:offset="0.55" android:color="#FF161B20" />
                    <item android:offset="1" android:color="#FF0F0F0F" />
                </gradient>
            </aapt:attr>
        </path>
    </group>
    <path
        android:fillColor="#FFE5383B"
        android:pathData="\(d)" />
</vector>

"""
try! xml.write(to: out, atomically: true, encoding: .utf8)
print(out.path, "word", n(bounds.width), "×", n(bounds.height))
