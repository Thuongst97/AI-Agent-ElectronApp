/**
 * Generates resources/icon.ico (Windows) and resources/icon.png (macOS/Linux).
 * No external dependencies — uses Node built-ins only.
 */
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { deflateSync } from 'zlib'

const __dir = dirname(fileURLToPath(import.meta.url))
const outDir = join(__dir, '..', 'resources')
mkdirSync(outDir, { recursive: true })

const SIZES = [256, 64, 48, 32, 16]

// Draw a simple "M" glyph into a 32-bit BGRA pixel array
function renderBitmap(size) {
  const pixels = new Uint8Array(size * size * 4) // BGRA

  // Background: #1e2841 (dark navy)
  const [bgB, bgG, bgR] = [0x41, 0x28, 0x1e]
  // Foreground: #63b3ed (blue)
  const [fgB, fgG, fgR] = [0xed, 0xb3, 0x63]

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4
      pixels[idx] = bgB; pixels[idx+1] = bgG; pixels[idx+2] = bgR; pixels[idx+3] = 255
    }
  }

  // Draw rounded rectangle background (slightly inset)
  const margin = Math.round(size * 0.08)
  const radius = Math.round(size * 0.2)
  for (let y = margin; y < size - margin; y++) {
    for (let x = margin; x < size - margin; x++) {
      // Round corners
      const cx = size / 2, cy = size / 2
      const rw = size / 2 - margin, rh = size / 2 - margin
      const dx = Math.max(0, Math.abs(x - cx) - (rw - radius))
      const dy = Math.max(0, Math.abs(y - cy) - (rh - radius))
      if (dx * dx + dy * dy <= radius * radius) {
        const idx = (y * size + x) * 4
        // Slightly lighter bg inside card: #1e3a5f
        pixels[idx] = 0x5f; pixels[idx+1] = 0x3a; pixels[idx+2] = 0x1e; pixels[idx+3] = 255
      }
    }
  }

  // Draw "M" using line segments
  const thick = Math.max(1, Math.round(size * 0.09))
  const top = Math.round(size * 0.22), bot = Math.round(size * 0.78)
  const left = Math.round(size * 0.2), right = Math.round(size * 0.8)
  const mid = Math.round(size * 0.5), midY = Math.round(size * 0.55)

  function drawLine(x1, y1, x2, y2) {
    const steps = Math.max(Math.abs(x2-x1), Math.abs(y2-y1)) * 4
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const px = x1 + (x2 - x1) * t
      const py = y1 + (y2 - y1) * t
      for (let dy = -thick/2; dy <= thick/2; dy++) {
        for (let dx = -thick/2; dx <= thick/2; dx++) {
          const fx = Math.round(px + dx), fy = Math.round(py + dy)
          if (fx >= 0 && fx < size && fy >= 0 && fy < size) {
            const idx = (fy * size + fx) * 4
            pixels[idx] = fgB; pixels[idx+1] = fgG; pixels[idx+2] = fgR; pixels[idx+3] = 255
          }
        }
      }
    }
  }

  drawLine(left, top, left, bot)       // left vertical
  drawLine(left, top, mid, midY)       // left diagonal down to center
  drawLine(mid, midY, right, top)      // right diagonal up from center
  drawLine(right, top, right, bot)     // right vertical

  return pixels
}

function makeBMPDIB(size, pixels) {
  // BITMAPINFOHEADER (40 bytes) + pixel data (bottom-up, 32-bit BGRA)
  const rowSize = size * 4
  const pixelDataSize = rowSize * size * 2  // XOR + AND mask
  const buf = Buffer.alloc(40 + pixelDataSize, 0)

  buf.writeUInt32LE(40, 0)             // biSize
  buf.writeInt32LE(size, 4)            // biWidth
  buf.writeInt32LE(size * 2, 8)        // biHeight (doubled = XOR + AND)
  buf.writeUInt16LE(1, 12)             // biPlanes
  buf.writeUInt16LE(32, 14)            // biBitCount
  buf.writeUInt32LE(0, 16)             // biCompression (BI_RGB)
  buf.writeUInt32LE(pixelDataSize, 20) // biSizeImage

  // Write XOR (color) data — bottom-up
  for (let y = 0; y < size; y++) {
    const srcRow = (size - 1 - y)  // flip vertical
    for (let x = 0; x < size; x++) {
      const srcIdx = (srcRow * size + x) * 4
      const dstIdx = 40 + (y * size + x) * 4
      buf[dstIdx]   = pixels[srcIdx]     // B
      buf[dstIdx+1] = pixels[srcIdx+1]   // G
      buf[dstIdx+2] = pixels[srcIdx+2]   // R
      buf[dstIdx+3] = pixels[srcIdx+3]   // A
    }
  }
  // AND mask (all zeros = fully visible) already zeroed by Buffer.alloc

  return buf
}

// Build ICO
const images = SIZES.map(size => {
  const pixels = renderBitmap(size)
  const bmp = makeBMPDIB(size, pixels)
  return { size, bmp }
})

const headerSize = 6 + 16 * images.length
let offset = headerSize
const header = Buffer.alloc(headerSize)

header.writeUInt16LE(0, 0)               // reserved
header.writeUInt16LE(1, 2)               // type: ICO
header.writeUInt16LE(images.length, 4)   // count

images.forEach(({ size, bmp }, i) => {
  const dirBase = 6 + i * 16
  header.writeUInt8(size === 256 ? 0 : size, dirBase)      // width (0=256)
  header.writeUInt8(size === 256 ? 0 : size, dirBase + 1)  // height
  header.writeUInt8(0, dirBase + 2)    // color count
  header.writeUInt8(0, dirBase + 3)    // reserved
  header.writeUInt16LE(1, dirBase + 4) // planes
  header.writeUInt16LE(32, dirBase + 6)// bit count
  header.writeUInt32LE(bmp.length, dirBase + 8)
  header.writeUInt32LE(offset, dirBase + 12)
  offset += bmp.length
})

const ico = Buffer.concat([header, ...images.map(i => i.bmp)])
const outPath = join(outDir, 'icon.ico')
writeFileSync(outPath, ico)
console.log(`✓ icon.ico created — ${(ico.length / 1024).toFixed(1)} KB  (${SIZES.join(', ')}px)`)

// ── Generate PNG (1024×1024) for macOS / Linux ─────────────────────────────
function makePNG(size) {
  const pixels = renderBitmap(size)  // BGRA

  // Convert BGRA → RGBA rows with filter byte 0 (None) prepended
  const rowLen = size * 4
  const raw = Buffer.alloc(size * (rowLen + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (rowLen + 1)] = 0  // filter type None
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4
      const dst = y * (rowLen + 1) + 1 + x * 4
      raw[dst]   = pixels[src + 2]  // R (was B in BGRA)
      raw[dst+1] = pixels[src + 1]  // G
      raw[dst+2] = pixels[src]      // B (was R in BGRA)
      raw[dst+3] = pixels[src + 3]  // A
    }
  }

  const compressed = deflateSync(raw, { level: 1 })

  function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const typeB = Buffer.from(type, 'ascii')
    const body = Buffer.concat([typeB, data])
    // CRC32
    let crc = 0xffffffff
    for (const b of body) {
      crc ^= b
      for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
    crc ^= 0xffffffff
    const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc >>> 0)
    return Buffer.concat([len, typeB, data, crcB])
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 6   // color type: RGBA
  // compression, filter, interlace = 0

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', compressed), chunk('IEND', Buffer.alloc(0))])
}

const pngPath = join(outDir, 'icon.png')
writeFileSync(pngPath, makePNG(512))
console.log('✓ icon.png created — 512×512px')
