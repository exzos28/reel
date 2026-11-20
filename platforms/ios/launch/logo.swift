// The launch screen's logotype: "reel" in Geist Bold, reel's red, as the app draws it (the
// loader's and the nav's), in the three densities. A launch screen cannot use the app's fonts.
//
//   swift platforms/ios/launch/logo.swift app/fonts/Geist.ttf platforms/ios/launch
import CoreGraphics
import CoreText
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
let fontURL = URL(fileURLWithPath: args[1]) as CFURL
let out = args[2]
let size: CGFloat = 44 // points
let tracking: CGFloat = -0.02 * size
guard let descs = CTFontManagerCreateFontDescriptorsFromURL(fontURL) as? [CTFontDescriptor], let desc = descs.first else { fatalError("no font") }
// Bold: the variable font's weight axis at 700.
let wght: UInt32 = 0x7767_6874
let bold = CTFontDescriptorCreateCopyWithAttributes(desc, [kCTFontVariationAttribute: [wght: 700]] as CFDictionary)
let red = CGColor(srgbRed: 0xE5 / 255.0, green: 0x38 / 255.0, blue: 0x3B / 255.0, alpha: 1)

for scale in [1, 2, 3] {
    let font = CTFontCreateWithFontDescriptor(bold, size * CGFloat(scale), nil)
    let text = NSAttributedString(string: "reel", attributes: [
        NSAttributedString.Key(kCTFontAttributeName as String): font,
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): red,
        NSAttributedString.Key(kCTKernAttributeName as String): tracking * CGFloat(scale),
    ])
    let line = CTLineCreateWithAttributedString(text)
    var ascent: CGFloat = 0, descent: CGFloat = 0
    let width = CTLineGetTypographicBounds(line, &ascent, &descent, nil)
    // Whole points, so @2x and @3x are exactly twice and three times @1x.
    // 4 points around it: the glyphs reach past the line's typographic width.
    let pad = 4 * scale
    let w = Int(ceil(width / CGFloat(scale))) * scale + 2 * pad, h = Int(ceil((ascent + descent) / CGFloat(scale))) * scale + 2 * pad
    let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    ctx.textPosition = CGPoint(x: (CGFloat(w) - width) / 2, y: descent + CGFloat(pad))
    CTLineDraw(line, ctx)
    let name = scale == 1 ? "launch-logo.png" : "launch-logo@\(scale)x.png"
    let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: "\(out)/\(name)") as CFURL, UTType.png.identifier as CFString, 1, nil)!
    CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
    CGImageDestinationFinalize(dest)
    print(name, w, h)
}
