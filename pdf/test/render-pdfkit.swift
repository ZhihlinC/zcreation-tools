// Renders pages of a PDF with macOS PDFKit/CoreGraphics — a reader that
// shares no code with this tool — and prints sampled pixel colours as JSON.
//   swift render-pdfkit.swift file.pdf samples.json
// samples.json: [{ "page": 1, "x": 0.25, "y": 0.1 }, ...]  (x, y = fraction of
// the displayed page, origin top-left, /Rotate applied, like the editor).
// Output: [{ "page", "x", "y", "rgb": [r, g, b] }, ...]
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count == 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])),
      let data = FileManager.default.contents(atPath: args[2]),
      let samples = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
  FileHandle.standardError.write("usage: swift render-pdfkit.swift file.pdf samples.json\n".data(using: .utf8)!)
  exit(2)
}

let scale: CGFloat = 2
var cache: [Int: (CGContext, Int, Int)] = [:]
func raster(_ n: Int) -> (CGContext, Int, Int) {
  if let c = cache[n] { return c }
  let page = doc.page(at: n - 1)!
  let bounds = page.bounds(for: .cropBox)
  let rot = ((page.rotation % 360) + 360) % 360
  let turned = rot == 90 || rot == 270
  let w = Int((turned ? bounds.height : bounds.width) * scale)
  let h = Int((turned ? bounds.width : bounds.height) * scale)
  let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
  ctx.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1))
  ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: scale, y: scale)
  page.draw(with: .cropBox, to: ctx) // applies /Rotate and the CropBox origin
  cache[n] = (ctx, w, h)
  return (ctx, w, h)
}

var out: [[String: Any]] = []
for s in samples {
  let n = s["page"] as! Int, fx = s["x"] as! Double, fy = s["y"] as! Double
  let (ctx, w, h) = raster(n)
  let px = min(w - 1, max(0, Int(fx * Double(w))))
  let py = min(h - 1, max(0, Int(fy * Double(h))))
  let buf = ctx.data!.assumingMemoryBound(to: UInt8.self)
  let i = (py * w + px) * 4 // CGBitmapContext rows run top to bottom in memory
  out.append(["page": n, "x": fx, "y": fy, "rgb": [Int(buf[i]), Int(buf[i + 1]), Int(buf[i + 2])]])
}
let json = try! JSONSerialization.data(withJSONObject: out)
print(String(data: json, encoding: .utf8)!)
