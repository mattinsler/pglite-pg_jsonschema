import type { WasmValidation } from './types.js';

const WASM_MAGIC = 0x6d736100; // \0asm in little-endian
const WASM_VERSION = 0x00000001;
const EXPORT_SECTION_ID = 7;
const TEXT_DECODER = new TextDecoder();

export interface ValidateOptions {
  readonly requireExports?: readonly string[];
}

export function validateWasmModule(bytes: Uint8Array, options?: ValidateOptions): WasmValidation {
  if (bytes.length < 8) {
    return { valid: false, exports: [], errors: ['Binary too small to be a valid WASM module'] };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = view.getUint32(0, true);
  if (magic !== WASM_MAGIC) {
    return { valid: false, exports: [], errors: ['Invalid WASM magic number'] };
  }

  const version = view.getUint32(4, true);
  if (version !== WASM_VERSION) {
    return { valid: false, exports: [], errors: [`Unsupported WASM version: ${version}`] };
  }

  const exports = parseExportSection(bytes);

  const errors: string[] = [];
  if (options?.requireExports) {
    for (const required of options.requireExports) {
      if (!exports.includes(required)) {
        errors.push(`Missing required export: ${required}`);
      }
    }
  }

  return { valid: errors.length === 0, exports, errors };
}

function parseExportSection(bytes: Uint8Array): string[] {
  let offset = 8;

  while (offset < bytes.length) {
    const sectionId = bytes[offset++];
    const { value: sectionSize, bytesRead } = readLEB128(bytes, offset);
    offset += bytesRead;

    if (sectionId === EXPORT_SECTION_ID) {
      return parseExports(bytes, offset);
    }

    offset += sectionSize;
  }

  return [];
}

function parseExports(bytes: Uint8Array, offset: number): string[] {
  const { value: count, bytesRead } = readLEB128(bytes, offset);
  let pos = offset + bytesRead;
  const exports: string[] = [];

  for (let i = 0; i < count; i++) {
    const { value: nameLen, bytesRead: nameLenBytes } = readLEB128(bytes, pos);
    pos += nameLenBytes;
    const name = TEXT_DECODER.decode(bytes.slice(pos, pos + nameLen));
    pos += nameLen;
    pos += 1; // export kind
    const { bytesRead: idxBytes } = readLEB128(bytes, pos);
    pos += idxBytes; // export index
    exports.push(name);
  }

  return exports;
}

function readLEB128(bytes: Uint8Array, offset: number): { value: number; bytesRead: number } {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;

  while (offset + bytesRead < bytes.length) {
    const byte = bytes[offset + bytesRead]!;
    value |= (byte & 0x7f) << shift;
    bytesRead++;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  return { value, bytesRead };
}
