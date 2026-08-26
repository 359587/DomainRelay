import { deflateSync } from 'node:zlib'
import { nativeImage, type NativeImage } from 'electron'

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])))
  return Buffer.concat([length, name, data, checksum])
}

function drawIconPng(): Buffer {
  const size = 18
  const pixels = Buffer.alloc((size * 4 + 1) * size)
  const setPixel = (x: number, y: number): void => {
    if (x < 0 || x >= size || y < 0 || y >= size) return
    const offset = y * (size * 4 + 1) + 1 + x * 4
    pixels[offset] = 0
    pixels[offset + 1] = 0
    pixels[offset + 2] = 0
    pixels[offset + 3] = 255
  }
  const line = (x0: number, y0: number, x1: number, y1: number): void => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))
    for (let step = 0; step <= steps; step += 1) {
      setPixel(Math.round(x0 + ((x1 - x0) * step) / steps), Math.round(y0 + ((y1 - y0) * step) / steps))
    }
  }
  const dot = (cx: number, cy: number): void => {
    for (let y = -1; y <= 1; y += 1) {
      for (let x = -1; x <= 1; x += 1) if (x * x + y * y <= 2) setPixel(cx + x, cy + y)
    }
  }
  const ring = (cx: number, cy: number, radius: number): void => {
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const distance = Math.hypot(x - cx, y - cy)
        if (Math.abs(distance - radius) < 0.72) setPixel(x, y)
      }
    }
  }

  ring(9, 9, 6)
  line(3, 9, 15, 9)
  line(9, 3, 9, 15)
  line(5, 5, 13, 13)
  dot(5, 5)
  dot(13, 13)

  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([signature, chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))])
}

export function createTrayIcon(): NativeImage {
  const image = nativeImage.createFromBuffer(drawIconPng())
  image.setTemplateImage(true)
  return image
}
