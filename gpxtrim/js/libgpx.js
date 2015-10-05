(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);throw new Error("Cannot find module '"+o+"'")}var f=n[o]={exports:{}};t[o][0].call(f.exports,function(e){var n=t[o][1][e];return s(n?n:e)},f,f.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */

var base64 = require('base64-js')
var ieee754 = require('ieee754')

exports.Buffer = Buffer
exports.SlowBuffer = Buffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192

/**
 * If `Buffer._useTypedArrays`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (compatible down to IE6)
 */
Buffer._useTypedArrays = (function () {
  // Detect if browser supports Typed Arrays. Supported browsers are IE 10+, Firefox 4+,
  // Chrome 7+, Safari 5.1+, Opera 11.6+, iOS 4.2+. If the browser does not support adding
  // properties to `Uint8Array` instances, then that's the same as no `Uint8Array` support
  // because we need to be able to add all the node Buffer API methods. This is an issue
  // in Firefox 4-29. Now fixed: https://bugzilla.mozilla.org/show_bug.cgi?id=695438
  try {
    var buf = new ArrayBuffer(0)
    var arr = new Uint8Array(buf)
    arr.foo = function () { return 42 }
    return 42 === arr.foo() &&
        typeof arr.subarray === 'function' // Chrome 9-10 lack `subarray`
  } catch (e) {
    return false
  }
})()

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (subject, encoding, noZero) {
  if (!(this instanceof Buffer))
    return new Buffer(subject, encoding, noZero)

  var type = typeof subject

  // Workaround: node's base64 implementation allows for non-padded strings
  // while base64-js does not.
  if (encoding === 'base64' && type === 'string') {
    subject = stringtrim(subject)
    while (subject.length % 4 !== 0) {
      subject = subject + '='
    }
  }

  // Find the length
  var length
  if (type === 'number')
    length = coerce(subject)
  else if (type === 'string')
    length = Buffer.byteLength(subject, encoding)
  else if (type === 'object')
    length = coerce(subject.length) // assume that object is array-like
  else
    throw new Error('First argument needs to be a number, array or string.')

  var buf
  if (Buffer._useTypedArrays) {
    // Preferred: Return an augmented `Uint8Array` instance for best performance
    buf = Buffer._augment(new Uint8Array(length))
  } else {
    // Fallback: Return THIS instance of Buffer (created by `new`)
    buf = this
    buf.length = length
    buf._isBuffer = true
  }

  var i
  if (Buffer._useTypedArrays && typeof subject.byteLength === 'number') {
    // Speed optimization -- use set if we're copying from a typed array
    buf._set(subject)
  } else if (isArrayish(subject)) {
    // Treat array-ish objects as a byte array
    for (i = 0; i < length; i++) {
      if (Buffer.isBuffer(subject))
        buf[i] = subject.readUInt8(i)
      else
        buf[i] = subject[i]
    }
  } else if (type === 'string') {
    buf.write(subject, 0, encoding)
  } else if (type === 'number' && !Buffer._useTypedArrays && !noZero) {
    for (i = 0; i < length; i++) {
      buf[i] = 0
    }
  }

  return buf
}

// STATIC METHODS
// ==============

Buffer.isEncoding = function (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.isBuffer = function (b) {
  return !!(b !== null && b !== undefined && b._isBuffer)
}

Buffer.byteLength = function (str, encoding) {
  var ret
  str = str + ''
  switch (encoding || 'utf8') {
    case 'hex':
      ret = str.length / 2
      break
    case 'utf8':
    case 'utf-8':
      ret = utf8ToBytes(str).length
      break
    case 'ascii':
    case 'binary':
    case 'raw':
      ret = str.length
      break
    case 'base64':
      ret = base64ToBytes(str).length
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = str.length * 2
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.concat = function (list, totalLength) {
  assert(isArray(list), 'Usage: Buffer.concat(list, [totalLength])\n' +
      'list should be an Array.')

  if (list.length === 0) {
    return new Buffer(0)
  } else if (list.length === 1) {
    return list[0]
  }

  var i
  if (typeof totalLength !== 'number') {
    totalLength = 0
    for (i = 0; i < list.length; i++) {
      totalLength += list[i].length
    }
  }

  var buf = new Buffer(totalLength)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

// BUFFER INSTANCE METHODS
// =======================

function _hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  assert(strLen % 2 === 0, 'Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var byte = parseInt(string.substr(i * 2, 2), 16)
    assert(!isNaN(byte), 'Invalid hex string')
    buf[offset + i] = byte
  }
  Buffer._charsWritten = i * 2
  return i
}

function _utf8Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf8ToBytes(string), buf, offset, length)
  return charsWritten
}

function _asciiWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(asciiToBytes(string), buf, offset, length)
  return charsWritten
}

function _binaryWrite (buf, string, offset, length) {
  return _asciiWrite(buf, string, offset, length)
}

function _base64Write (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(base64ToBytes(string), buf, offset, length)
  return charsWritten
}

function _utf16leWrite (buf, string, offset, length) {
  var charsWritten = Buffer._charsWritten =
    blitBuffer(utf16leToBytes(string), buf, offset, length)
  return charsWritten
}

Buffer.prototype.write = function (string, offset, length, encoding) {
  // Support both (string, offset, length, encoding)
  // and the legacy (string, encoding, offset, length)
  if (isFinite(offset)) {
    if (!isFinite(length)) {
      encoding = length
      length = undefined
    }
  } else {  // legacy
    var swap = encoding
    encoding = offset
    offset = length
    length = swap
  }

  offset = Number(offset) || 0
  var remaining = this.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }
  encoding = String(encoding || 'utf8').toLowerCase()

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexWrite(this, string, offset, length)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Write(this, string, offset, length)
      break
    case 'ascii':
      ret = _asciiWrite(this, string, offset, length)
      break
    case 'binary':
      ret = _binaryWrite(this, string, offset, length)
      break
    case 'base64':
      ret = _base64Write(this, string, offset, length)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leWrite(this, string, offset, length)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toString = function (encoding, start, end) {
  var self = this

  encoding = String(encoding || 'utf8').toLowerCase()
  start = Number(start) || 0
  end = (end !== undefined)
    ? Number(end)
    : end = self.length

  // Fastpath empty strings
  if (end === start)
    return ''

  var ret
  switch (encoding) {
    case 'hex':
      ret = _hexSlice(self, start, end)
      break
    case 'utf8':
    case 'utf-8':
      ret = _utf8Slice(self, start, end)
      break
    case 'ascii':
      ret = _asciiSlice(self, start, end)
      break
    case 'binary':
      ret = _binarySlice(self, start, end)
      break
    case 'base64':
      ret = _base64Slice(self, start, end)
      break
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      ret = _utf16leSlice(self, start, end)
      break
    default:
      throw new Error('Unknown encoding')
  }
  return ret
}

Buffer.prototype.toJSON = function () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function (target, target_start, start, end) {
  var source = this

  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (!target_start) target_start = 0

  // Copy 0 bytes; we're done
  if (end === start) return
  if (target.length === 0 || source.length === 0) return

  // Fatal error conditions
  assert(end >= start, 'sourceEnd < sourceStart')
  assert(target_start >= 0 && target_start < target.length,
      'targetStart out of bounds')
  assert(start >= 0 && start < source.length, 'sourceStart out of bounds')
  assert(end >= 0 && end <= source.length, 'sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length)
    end = this.length
  if (target.length - target_start < end - start)
    end = target.length - target_start + start

  var len = end - start

  if (len < 100 || !Buffer._useTypedArrays) {
    for (var i = 0; i < len; i++)
      target[i + target_start] = this[i + start]
  } else {
    target._set(this.subarray(start, start + len), target_start)
  }
}

function _base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function _utf8Slice (buf, start, end) {
  var res = ''
  var tmp = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    if (buf[i] <= 0x7F) {
      res += decodeUtf8Char(tmp) + String.fromCharCode(buf[i])
      tmp = ''
    } else {
      tmp += '%' + buf[i].toString(16)
    }
  }

  return res + decodeUtf8Char(tmp)
}

function _asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++)
    ret += String.fromCharCode(buf[i])
  return ret
}

function _binarySlice (buf, start, end) {
  return _asciiSlice(buf, start, end)
}

function _hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function _utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i+1] * 256)
  }
  return res
}

Buffer.prototype.slice = function (start, end) {
  var len = this.length
  start = clamp(start, len, 0)
  end = clamp(end, len, len)

  if (Buffer._useTypedArrays) {
    return Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    var newBuf = new Buffer(sliceLen, undefined, true)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
    return newBuf
  }
}

// `get` will be removed in Node 0.13+
Buffer.prototype.get = function (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` will be removed in Node 0.13+
Buffer.prototype.set = function (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

Buffer.prototype.readUInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  return this[offset]
}

function _readUInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    val = buf[offset]
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
  } else {
    val = buf[offset] << 8
    if (offset + 1 < len)
      val |= buf[offset + 1]
  }
  return val
}

Buffer.prototype.readUInt16LE = function (offset, noAssert) {
  return _readUInt16(this, offset, true, noAssert)
}

Buffer.prototype.readUInt16BE = function (offset, noAssert) {
  return _readUInt16(this, offset, false, noAssert)
}

function _readUInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val
  if (littleEndian) {
    if (offset + 2 < len)
      val = buf[offset + 2] << 16
    if (offset + 1 < len)
      val |= buf[offset + 1] << 8
    val |= buf[offset]
    if (offset + 3 < len)
      val = val + (buf[offset + 3] << 24 >>> 0)
  } else {
    if (offset + 1 < len)
      val = buf[offset + 1] << 16
    if (offset + 2 < len)
      val |= buf[offset + 2] << 8
    if (offset + 3 < len)
      val |= buf[offset + 3]
    val = val + (buf[offset] << 24 >>> 0)
  }
  return val
}

Buffer.prototype.readUInt32LE = function (offset, noAssert) {
  return _readUInt32(this, offset, true, noAssert)
}

Buffer.prototype.readUInt32BE = function (offset, noAssert) {
  return _readUInt32(this, offset, false, noAssert)
}

Buffer.prototype.readInt8 = function (offset, noAssert) {
  if (!noAssert) {
    assert(offset !== undefined && offset !== null,
        'missing offset')
    assert(offset < this.length, 'Trying to read beyond buffer length')
  }

  if (offset >= this.length)
    return

  var neg = this[offset] & 0x80
  if (neg)
    return (0xff - this[offset] + 1) * -1
  else
    return this[offset]
}

function _readInt16 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt16(buf, offset, littleEndian, true)
  var neg = val & 0x8000
  if (neg)
    return (0xffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt16LE = function (offset, noAssert) {
  return _readInt16(this, offset, true, noAssert)
}

Buffer.prototype.readInt16BE = function (offset, noAssert) {
  return _readInt16(this, offset, false, noAssert)
}

function _readInt32 (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  var len = buf.length
  if (offset >= len)
    return

  var val = _readUInt32(buf, offset, littleEndian, true)
  var neg = val & 0x80000000
  if (neg)
    return (0xffffffff - val + 1) * -1
  else
    return val
}

Buffer.prototype.readInt32LE = function (offset, noAssert) {
  return _readInt32(this, offset, true, noAssert)
}

Buffer.prototype.readInt32BE = function (offset, noAssert) {
  return _readInt32(this, offset, false, noAssert)
}

function _readFloat (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 3 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 23, 4)
}

Buffer.prototype.readFloatLE = function (offset, noAssert) {
  return _readFloat(this, offset, true, noAssert)
}

Buffer.prototype.readFloatBE = function (offset, noAssert) {
  return _readFloat(this, offset, false, noAssert)
}

function _readDouble (buf, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset + 7 < buf.length, 'Trying to read beyond buffer length')
  }

  return ieee754.read(buf, offset, littleEndian, 52, 8)
}

Buffer.prototype.readDoubleLE = function (offset, noAssert) {
  return _readDouble(this, offset, true, noAssert)
}

Buffer.prototype.readDoubleBE = function (offset, noAssert) {
  return _readDouble(this, offset, false, noAssert)
}

Buffer.prototype.writeUInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'trying to write beyond buffer length')
    verifuint(value, 0xff)
  }

  if (offset >= this.length) return

  this[offset] = value
}

function _writeUInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 2); i < j; i++) {
    buf[offset + i] =
        (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
            (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt16BE = function (value, offset, noAssert) {
  _writeUInt16(this, value, offset, false, noAssert)
}

function _writeUInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'trying to write beyond buffer length')
    verifuint(value, 0xffffffff)
  }

  var len = buf.length
  if (offset >= len)
    return

  for (var i = 0, j = Math.min(len - offset, 4); i < j; i++) {
    buf[offset + i] =
        (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeUInt32BE = function (value, offset, noAssert) {
  _writeUInt32(this, value, offset, false, noAssert)
}

Buffer.prototype.writeInt8 = function (value, offset, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset < this.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7f, -0x80)
  }

  if (offset >= this.length)
    return

  if (value >= 0)
    this.writeUInt8(value, offset, noAssert)
  else
    this.writeUInt8(0xff + value + 1, offset, noAssert)
}

function _writeInt16 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 1 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fff, -0x8000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt16(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt16(buf, 0xffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt16LE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt16BE = function (value, offset, noAssert) {
  _writeInt16(this, value, offset, false, noAssert)
}

function _writeInt32 (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifsint(value, 0x7fffffff, -0x80000000)
  }

  var len = buf.length
  if (offset >= len)
    return

  if (value >= 0)
    _writeUInt32(buf, value, offset, littleEndian, noAssert)
  else
    _writeUInt32(buf, 0xffffffff + value + 1, offset, littleEndian, noAssert)
}

Buffer.prototype.writeInt32LE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, true, noAssert)
}

Buffer.prototype.writeInt32BE = function (value, offset, noAssert) {
  _writeInt32(this, value, offset, false, noAssert)
}

function _writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 3 < buf.length, 'Trying to write beyond buffer length')
    verifIEEE754(value, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 23, 4)
}

Buffer.prototype.writeFloatLE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function (value, offset, noAssert) {
  _writeFloat(this, value, offset, false, noAssert)
}

function _writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    assert(value !== undefined && value !== null, 'missing value')
    assert(typeof littleEndian === 'boolean', 'missing or invalid endian')
    assert(offset !== undefined && offset !== null, 'missing offset')
    assert(offset + 7 < buf.length,
        'Trying to write beyond buffer length')
    verifIEEE754(value, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }

  var len = buf.length
  if (offset >= len)
    return

  ieee754.write(buf, value, offset, littleEndian, 52, 8)
}

Buffer.prototype.writeDoubleLE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function (value, offset, noAssert) {
  _writeDouble(this, value, offset, false, noAssert)
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (typeof value === 'string') {
    value = value.charCodeAt(0)
  }

  assert(typeof value === 'number' && !isNaN(value), 'value is not a number')
  assert(end >= start, 'end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  assert(start >= 0 && start < this.length, 'start out of bounds')
  assert(end >= 0 && end <= this.length, 'end out of bounds')

  for (var i = start; i < end; i++) {
    this[i] = value
  }
}

Buffer.prototype.inspect = function () {
  var out = []
  var len = this.length
  for (var i = 0; i < len; i++) {
    out[i] = toHex(this[i])
    if (i === exports.INSPECT_MAX_BYTES) {
      out[i + 1] = '...'
      break
    }
  }
  return '<Buffer ' + out.join(' ') + '>'
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer._useTypedArrays) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1)
        buf[i] = this[i]
      return buf.buffer
    }
  } else {
    throw new Error('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function (arr) {
  arr._isBuffer = true

  // save reference to original Uint8Array get/set methods before overwriting
  arr._get = arr.get
  arr._set = arr.set

  // deprecated, will be removed in node 0.13+
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

// slice(start, end)
function clamp (index, len, defaultValue) {
  if (typeof index !== 'number') return defaultValue
  index = ~~index;  // Coerce to integer.
  if (index >= len) return len
  if (index >= 0) return index
  index += len
  if (index >= 0) return index
  return 0
}

function coerce (length) {
  // Coerce length to a number (possibly NaN), round up
  // in case it's fractional (e.g. 123.456) then do a
  // double negate to coerce a NaN to 0. Easy, right?
  length = ~~Math.ceil(+length)
  return length < 0 ? 0 : length
}

function isArray (subject) {
  return (Array.isArray || function (subject) {
    return Object.prototype.toString.call(subject) === '[object Array]'
  })(subject)
}

function isArrayish (subject) {
  return isArray(subject) || Buffer.isBuffer(subject) ||
      subject && typeof subject === 'object' &&
      typeof subject.length === 'number'
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    var b = str.charCodeAt(i)
    if (b <= 0x7F)
      byteArray.push(str.charCodeAt(i))
    else {
      var start = i
      if (b >= 0xD800 && b <= 0xDFFF) i++
      var h = encodeURIComponent(str.slice(start, i+1)).substr(1).split('%')
      for (var j = 0; j < h.length; j++)
        byteArray.push(parseInt(h[j], 16))
    }
  }
  return byteArray
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(str)
}

function blitBuffer (src, dst, offset, length) {
  var pos
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length))
      break
    dst[i + offset] = src[i]
  }
  return i
}

function decodeUtf8Char (str) {
  try {
    return decodeURIComponent(str)
  } catch (err) {
    return String.fromCharCode(0xFFFD) // UTF 8 invalid char
  }
}

/*
 * We have to make sure that the value is a valid integer. This means that it
 * is non-negative. It has no fractional component and that it does not
 * exceed the maximum allowed value.
 */
function verifuint (value, max) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value >= 0, 'specified a negative value for writing an unsigned value')
  assert(value <= max, 'value is larger than maximum value for type')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifsint (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
  assert(Math.floor(value) === value, 'value has a fractional component')
}

function verifIEEE754 (value, max, min) {
  assert(typeof value === 'number', 'cannot write a non-number as a number')
  assert(value <= max, 'value larger than maximum allowed value')
  assert(value >= min, 'value smaller than minimum allowed value')
}

function assert (test, message) {
  if (!test) throw new Error(message || 'Failed assertion')
}

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\buffer\\index.js","/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\buffer")
},{"VCmEsw":4,"base64-js":2,"buffer":1,"ieee754":3}],2:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\buffer\\node_modules\\base64-js\\lib\\b64.js","/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\buffer\\node_modules\\base64-js\\lib")
},{"VCmEsw":4,"buffer":1}],3:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\buffer\\node_modules\\ieee754\\index.js","/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\buffer\\node_modules\\ieee754")
},{"VCmEsw":4,"buffer":1}],4:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
// shim for using process in browser

var process = module.exports = {};

process.nextTick = (function () {
    var canSetImmediate = typeof window !== 'undefined'
    && window.setImmediate;
    var canPost = typeof window !== 'undefined'
    && window.postMessage && window.addEventListener
    ;

    if (canSetImmediate) {
        return function (f) { return window.setImmediate(f) };
    }

    if (canPost) {
        var queue = [];
        window.addEventListener('message', function (ev) {
            var source = ev.source;
            if ((source === window || source === null) && ev.data === 'process-tick') {
                ev.stopPropagation();
                if (queue.length > 0) {
                    var fn = queue.shift();
                    fn();
                }
            }
        }, true);

        return function nextTick(fn) {
            queue.push(fn);
            window.postMessage('process-tick', '*');
        };
    }

    return function nextTick(fn) {
        setTimeout(fn, 0);
    };
})();

process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
}

// TODO(shtylman)
process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\process\\browser.js","/..\\node_modules\\gulp-browserify\\node_modules\\browserify\\node_modules\\process")
},{"VCmEsw":4,"buffer":1}],5:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
function DOMParser(options){
	this.options = options ||{locator:{}};
	
}
DOMParser.prototype.parseFromString = function(source,mimeType){	
	var options = this.options;
	var sax =  new XMLReader();
	var domBuilder = options.domBuilder || new DOMHandler();//contentHandler and LexicalHandler
	var errorHandler = options.errorHandler;
	var locator = options.locator;
	var defaultNSMap = options.xmlns||{};
	var entityMap = {'lt':'<','gt':'>','amp':'&','quot':'"','apos':"'"}
	if(locator){
		domBuilder.setDocumentLocator(locator)
	}
	
	sax.errorHandler = buildErrorHandler(errorHandler,domBuilder,locator);
	sax.domBuilder = options.domBuilder || domBuilder;
	if(/\/x?html?$/.test(mimeType)){
		entityMap.nbsp = '\xa0';
		entityMap.copy = '\xa9';
		defaultNSMap['']= 'http://www.w3.org/1999/xhtml';
	}
	if(source){
		sax.parse(source,defaultNSMap,entityMap);
	}else{
		sax.errorHandler.error("invalid document source");
	}
	return domBuilder.document;
}
function buildErrorHandler(errorImpl,domBuilder,locator){
	if(!errorImpl){
		if(domBuilder instanceof DOMHandler){
			return domBuilder;
		}
		errorImpl = domBuilder ;
	}
	var errorHandler = {}
	var isCallback = errorImpl instanceof Function;
	locator = locator||{}
	function build(key){
		var fn = errorImpl[key];
		if(!fn){
			if(isCallback){
				fn = errorImpl.length == 2?function(msg){errorImpl(key,msg)}:errorImpl;
			}else{
				var i=arguments.length;
				while(--i){
					if(fn = errorImpl[arguments[i]]){
						break;
					}
				}
			}
		}
		errorHandler[key] = fn && function(msg){
			fn(msg+_locator(locator));
		}||function(){};
	}
	build('warning','warn');
	build('error','warn','warning');
	build('fatalError','warn','warning','error');
	return errorHandler;
}
/**
 * +ContentHandler+ErrorHandler
 * +LexicalHandler+EntityResolver2
 * -DeclHandler-DTDHandler 
 * 
 * DefaultHandler:EntityResolver, DTDHandler, ContentHandler, ErrorHandler
 * DefaultHandler2:DefaultHandler,LexicalHandler, DeclHandler, EntityResolver2
 * @link http://www.saxproject.org/apidoc/org/xml/sax/helpers/DefaultHandler.html
 */
function DOMHandler() {
    this.cdata = false;
}
function position(locator,node){
	node.lineNumber = locator.lineNumber;
	node.columnNumber = locator.columnNumber;
}
/**
 * @see org.xml.sax.ContentHandler#startDocument
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ContentHandler.html
 */ 
DOMHandler.prototype = {
	startDocument : function() {
    	this.document = new DOMImplementation().createDocument(null, null, null);
    	if (this.locator) {
        	this.document.documentURI = this.locator.systemId;
    	}
	},
	startElement:function(namespaceURI, localName, qName, attrs) {
		var doc = this.document;
	    var el = doc.createElementNS(namespaceURI, qName||localName);
	    var len = attrs.length;
	    appendElement(this, el);
	    this.currentElement = el;
	    
		this.locator && position(this.locator,el)
	    for (var i = 0 ; i < len; i++) {
	        var namespaceURI = attrs.getURI(i);
	        var value = attrs.getValue(i);
	        var qName = attrs.getQName(i);
			var attr = doc.createAttributeNS(namespaceURI, qName);
			if( attr.getOffset){
				position(attr.getOffset(1),attr)
			}
			attr.value = attr.nodeValue = value;
			el.setAttributeNode(attr)
	    }
	},
	endElement:function(namespaceURI, localName, qName) {
		var current = this.currentElement
	    var tagName = current.tagName;
	    this.currentElement = current.parentNode;
	},
	startPrefixMapping:function(prefix, uri) {
	},
	endPrefixMapping:function(prefix) {
	},
	processingInstruction:function(target, data) {
	    var ins = this.document.createProcessingInstruction(target, data);
	    this.locator && position(this.locator,ins)
	    appendElement(this, ins);
	},
	ignorableWhitespace:function(ch, start, length) {
	},
	characters:function(chars, start, length) {
		chars = _toString.apply(this,arguments)
		//console.log(chars)
		if(this.currentElement && chars){
			if (this.cdata) {
				var charNode = this.document.createCDATASection(chars);
				this.currentElement.appendChild(charNode);
			} else {
				var charNode = this.document.createTextNode(chars);
				this.currentElement.appendChild(charNode);
			}
			this.locator && position(this.locator,charNode)
		}
	},
	skippedEntity:function(name) {
	},
	endDocument:function() {
		this.document.normalize();
	},
	setDocumentLocator:function (locator) {
	    if(this.locator = locator){// && !('lineNumber' in locator)){
	    	locator.lineNumber = 0;
	    }
	},
	//LexicalHandler
	comment:function(chars, start, length) {
		chars = _toString.apply(this,arguments)
	    var comm = this.document.createComment(chars);
	    this.locator && position(this.locator,comm)
	    appendElement(this, comm);
	},
	
	startCDATA:function() {
	    //used in characters() methods
	    this.cdata = true;
	},
	endCDATA:function() {
	    this.cdata = false;
	},
	
	startDTD:function(name, publicId, systemId) {
		var impl = this.document.implementation;
	    if (impl && impl.createDocumentType) {
	        var dt = impl.createDocumentType(name, publicId, systemId);
	        this.locator && position(this.locator,dt)
	        appendElement(this, dt);
	    }
	},
	/**
	 * @see org.xml.sax.ErrorHandler
	 * @link http://www.saxproject.org/apidoc/org/xml/sax/ErrorHandler.html
	 */
	warning:function(error) {
		console.warn(error,_locator(this.locator));
	},
	error:function(error) {
		console.error(error,_locator(this.locator));
	},
	fatalError:function(error) {
		console.error(error,_locator(this.locator));
	    throw error;
	}
}
function _locator(l){
	if(l){
		return '\n@'+(l.systemId ||'')+'#[line:'+l.lineNumber+',col:'+l.columnNumber+']'
	}
}
function _toString(chars,start,length){
	if(typeof chars == 'string'){
		return chars.substr(start,length)
	}else{//java sax connect width xmldom on rhino(what about: "? && !(chars instanceof String)")
		if(chars.length >= start+length || start){
			return new java.lang.String(chars,start,length)+'';
		}
		return chars;
	}
}

/*
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/LexicalHandler.html
 * used method of org.xml.sax.ext.LexicalHandler:
 *  #comment(chars, start, length)
 *  #startCDATA()
 *  #endCDATA()
 *  #startDTD(name, publicId, systemId)
 *
 *
 * IGNORED method of org.xml.sax.ext.LexicalHandler:
 *  #endDTD()
 *  #startEntity(name)
 *  #endEntity(name)
 *
 *
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/DeclHandler.html
 * IGNORED method of org.xml.sax.ext.DeclHandler
 * 	#attributeDecl(eName, aName, type, mode, value)
 *  #elementDecl(name, model)
 *  #externalEntityDecl(name, publicId, systemId)
 *  #internalEntityDecl(name, value)
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/EntityResolver2.html
 * IGNORED method of org.xml.sax.EntityResolver2
 *  #resolveEntity(String name,String publicId,String baseURI,String systemId)
 *  #resolveEntity(publicId, systemId)
 *  #getExternalSubset(name, baseURI)
 * @link http://www.saxproject.org/apidoc/org/xml/sax/DTDHandler.html
 * IGNORED method of org.xml.sax.DTDHandler
 *  #notationDecl(name, publicId, systemId) {};
 *  #unparsedEntityDecl(name, publicId, systemId, notationName) {};
 */
"endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(/\w+/g,function(key){
	DOMHandler.prototype[key] = function(){return null}
})

/* Private static helpers treated below as private instance methods, so don't need to add these to the public API; we might use a Relator to also get rid of non-standard public properties */
function appendElement (hander,node) {
    if (!hander.currentElement) {
        hander.document.appendChild(node);
    } else {
        hander.currentElement.appendChild(node);
    }
}//appendChild and setAttributeNS are preformance key

if(typeof require == 'function'){
	var XMLReader = require('./sax').XMLReader;
	var DOMImplementation = exports.DOMImplementation = require('./dom').DOMImplementation;
	exports.XMLSerializer = require('./dom').XMLSerializer ;
	exports.DOMParser = DOMParser;
}

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/..\\node_modules\\xmldom\\dom-parser.js","/..\\node_modules\\xmldom")
},{"./dom":6,"./sax":7,"VCmEsw":4,"buffer":1}],6:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/*
 * DOM Level 2
 * Object DOMException
 * @see http://www.w3.org/TR/REC-DOM-Level-1/ecma-script-language-binding.html
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/ecma-script-binding.html
 */

function copy(src,dest){
	for(var p in src){
		dest[p] = src[p];
	}
}
/**
^\w+\.prototype\.([_\w]+)\s*=\s*((?:.*\{\s*?[\r\n][\s\S]*?^})|\S.*?(?=[;\r\n]));?
^\w+\.prototype\.([_\w]+)\s*=\s*(\S.*?(?=[;\r\n]));?
 */
function _extends(Class,Super){
	var pt = Class.prototype;
	if(Object.create){
		var ppt = Object.create(Super.prototype)
		pt.__proto__ = ppt;
	}
	if(!(pt instanceof Super)){
		function t(){};
		t.prototype = Super.prototype;
		t = new t();
		copy(pt,t);
		Class.prototype = pt = t;
	}
	if(pt.constructor != Class){
		if(typeof Class != 'function'){
			console.error("unknow Class:"+Class)
		}
		pt.constructor = Class
	}
}
var htmlns = 'http://www.w3.org/1999/xhtml' ;
// Node Types
var NodeType = {}
var ELEMENT_NODE                = NodeType.ELEMENT_NODE                = 1;
var ATTRIBUTE_NODE              = NodeType.ATTRIBUTE_NODE              = 2;
var TEXT_NODE                   = NodeType.TEXT_NODE                   = 3;
var CDATA_SECTION_NODE          = NodeType.CDATA_SECTION_NODE          = 4;
var ENTITY_REFERENCE_NODE       = NodeType.ENTITY_REFERENCE_NODE       = 5;
var ENTITY_NODE                 = NodeType.ENTITY_NODE                 = 6;
var PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE = 7;
var COMMENT_NODE                = NodeType.COMMENT_NODE                = 8;
var DOCUMENT_NODE               = NodeType.DOCUMENT_NODE               = 9;
var DOCUMENT_TYPE_NODE          = NodeType.DOCUMENT_TYPE_NODE          = 10;
var DOCUMENT_FRAGMENT_NODE      = NodeType.DOCUMENT_FRAGMENT_NODE      = 11;
var NOTATION_NODE               = NodeType.NOTATION_NODE               = 12;

// ExceptionCode
var ExceptionCode = {}
var ExceptionMessage = {};
var INDEX_SIZE_ERR              = ExceptionCode.INDEX_SIZE_ERR              = ((ExceptionMessage[1]="Index size error"),1);
var DOMSTRING_SIZE_ERR          = ExceptionCode.DOMSTRING_SIZE_ERR          = ((ExceptionMessage[2]="DOMString size error"),2);
var HIERARCHY_REQUEST_ERR       = ExceptionCode.HIERARCHY_REQUEST_ERR       = ((ExceptionMessage[3]="Hierarchy request error"),3);
var WRONG_DOCUMENT_ERR          = ExceptionCode.WRONG_DOCUMENT_ERR          = ((ExceptionMessage[4]="Wrong document"),4);
var INVALID_CHARACTER_ERR       = ExceptionCode.INVALID_CHARACTER_ERR       = ((ExceptionMessage[5]="Invalid character"),5);
var NO_DATA_ALLOWED_ERR         = ExceptionCode.NO_DATA_ALLOWED_ERR         = ((ExceptionMessage[6]="No data allowed"),6);
var NO_MODIFICATION_ALLOWED_ERR = ExceptionCode.NO_MODIFICATION_ALLOWED_ERR = ((ExceptionMessage[7]="No modification allowed"),7);
var NOT_FOUND_ERR               = ExceptionCode.NOT_FOUND_ERR               = ((ExceptionMessage[8]="Not found"),8);
var NOT_SUPPORTED_ERR           = ExceptionCode.NOT_SUPPORTED_ERR           = ((ExceptionMessage[9]="Not supported"),9);
var INUSE_ATTRIBUTE_ERR         = ExceptionCode.INUSE_ATTRIBUTE_ERR         = ((ExceptionMessage[10]="Attribute in use"),10);
//level2
var INVALID_STATE_ERR        	= ExceptionCode.INVALID_STATE_ERR        	= ((ExceptionMessage[11]="Invalid state"),11);
var SYNTAX_ERR               	= ExceptionCode.SYNTAX_ERR               	= ((ExceptionMessage[12]="Syntax error"),12);
var INVALID_MODIFICATION_ERR 	= ExceptionCode.INVALID_MODIFICATION_ERR 	= ((ExceptionMessage[13]="Invalid modification"),13);
var NAMESPACE_ERR            	= ExceptionCode.NAMESPACE_ERR           	= ((ExceptionMessage[14]="Invalid namespace"),14);
var INVALID_ACCESS_ERR       	= ExceptionCode.INVALID_ACCESS_ERR      	= ((ExceptionMessage[15]="Invalid access"),15);


function DOMException(code, message) {
	if(message instanceof Error){
		var error = message;
	}else{
		error = this;
		Error.call(this, ExceptionMessage[code]);
		this.message = ExceptionMessage[code];
		if(Error.captureStackTrace) Error.captureStackTrace(this, DOMException);
	}
	error.code = code;
	if(message) this.message = this.message + ": " + message;
	return error;
};
DOMException.prototype = Error.prototype;
copy(ExceptionCode,DOMException)
/**
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/core.html#ID-536297177
 * The NodeList interface provides the abstraction of an ordered collection of nodes, without defining or constraining how this collection is implemented. NodeList objects in the DOM are live.
 * The items in the NodeList are accessible via an integral index, starting from 0.
 */
function NodeList() {
};
NodeList.prototype = {
	/**
	 * The number of nodes in the list. The range of valid child node indices is 0 to length-1 inclusive.
	 * @standard level1
	 */
	length:0, 
	/**
	 * Returns the indexth item in the collection. If index is greater than or equal to the number of nodes in the list, this returns null.
	 * @standard level1
	 * @param index  unsigned long 
	 *   Index into the collection.
	 * @return Node
	 * 	The node at the indexth position in the NodeList, or null if that is not a valid index. 
	 */
	item: function(index) {
		return this[index] || null;
	}
};
function LiveNodeList(node,refresh){
	this._node = node;
	this._refresh = refresh
	_updateLiveList(this);
}
function _updateLiveList(list){
	var inc = list._node._inc || list._node.ownerDocument._inc;
	if(list._inc != inc){
		var ls = list._refresh(list._node);
		//console.log(ls.length)
		__set__(list,'length',ls.length);
		copy(ls,list);
		list._inc = inc;
	}
}
LiveNodeList.prototype.item = function(i){
	_updateLiveList(this);
	return this[i];
}

_extends(LiveNodeList,NodeList);
/**
 * 
 * Objects implementing the NamedNodeMap interface are used to represent collections of nodes that can be accessed by name. Note that NamedNodeMap does not inherit from NodeList; NamedNodeMaps are not maintained in any particular order. Objects contained in an object implementing NamedNodeMap may also be accessed by an ordinal index, but this is simply to allow convenient enumeration of the contents of a NamedNodeMap, and does not imply that the DOM specifies an order to these Nodes.
 * NamedNodeMap objects in the DOM are live.
 * used for attributes or DocumentType entities 
 */
function NamedNodeMap() {
};

function _findNodeIndex(list,node){
	var i = list.length;
	while(i--){
		if(list[i] === node){return i}
	}
}

function _addNamedNode(el,list,newAttr,oldAttr){
	if(oldAttr){
		list[_findNodeIndex(list,oldAttr)] = newAttr;
	}else{
		list[list.length++] = newAttr;
	}
	if(el){
		newAttr.ownerElement = el;
		var doc = el.ownerDocument;
		if(doc){
			oldAttr && _onRemoveAttribute(doc,el,oldAttr);
			_onAddAttribute(doc,el,newAttr);
		}
	}
}
function _removeNamedNode(el,list,attr){
	var i = _findNodeIndex(list,attr);
	if(i>=0){
		var lastIndex = list.length-1
		while(i<lastIndex){
			list[i] = list[++i]
		}
		list.length = lastIndex;
		if(el){
			var doc = el.ownerDocument;
			if(doc){
				_onRemoveAttribute(doc,el,attr);
				attr.ownerElement = null;
			}
		}
	}else{
		throw DOMException(NOT_FOUND_ERR,new Error())
	}
}
NamedNodeMap.prototype = {
	length:0,
	item:NodeList.prototype.item,
	getNamedItem: function(key) {
//		if(key.indexOf(':')>0 || key == 'xmlns'){
//			return null;
//		}
		var i = this.length;
		while(i--){
			var attr = this[i];
			if(attr.nodeName == key){
				return attr;
			}
		}
	},
	setNamedItem: function(attr) {
		var el = attr.ownerElement;
		if(el && el!=this._ownerElement){
			throw new DOMException(INUSE_ATTRIBUTE_ERR);
		}
		var oldAttr = this.getNamedItem(attr.nodeName);
		_addNamedNode(this._ownerElement,this,attr,oldAttr);
		return oldAttr;
	},
	/* returns Node */
	setNamedItemNS: function(attr) {// raises: WRONG_DOCUMENT_ERR,NO_MODIFICATION_ALLOWED_ERR,INUSE_ATTRIBUTE_ERR
		var el = attr.ownerElement, oldAttr;
		if(el && el!=this._ownerElement){
			throw new DOMException(INUSE_ATTRIBUTE_ERR);
		}
		oldAttr = this.getNamedItemNS(attr.namespaceURI,attr.localName);
		_addNamedNode(this._ownerElement,this,attr,oldAttr);
		return oldAttr;
	},

	/* returns Node */
	removeNamedItem: function(key) {
		var attr = this.getNamedItem(key);
		_removeNamedNode(this._ownerElement,this,attr);
		return attr;
		
		
	},// raises: NOT_FOUND_ERR,NO_MODIFICATION_ALLOWED_ERR
	
	//for level2
	removeNamedItemNS:function(namespaceURI,localName){
		var attr = this.getNamedItemNS(namespaceURI,localName);
		_removeNamedNode(this._ownerElement,this,attr);
		return attr;
	},
	getNamedItemNS: function(namespaceURI, localName) {
		var i = this.length;
		while(i--){
			var node = this[i];
			if(node.localName == localName && node.namespaceURI == namespaceURI){
				return node;
			}
		}
		return null;
	}
};
/**
 * @see http://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-102161490
 */
function DOMImplementation(/* Object */ features) {
	this._features = {};
	if (features) {
		for (var feature in features) {
			 this._features = features[feature];
		}
	}
};

DOMImplementation.prototype = {
	hasFeature: function(/* string */ feature, /* string */ version) {
		var versions = this._features[feature.toLowerCase()];
		if (versions && (!version || version in versions)) {
			return true;
		} else {
			return false;
		}
	},
	// Introduced in DOM Level 2:
	createDocument:function(namespaceURI,  qualifiedName, doctype){// raises:INVALID_CHARACTER_ERR,NAMESPACE_ERR,WRONG_DOCUMENT_ERR
		var doc = new Document();
		doc.doctype = doctype;
		if(doctype){
			doc.appendChild(doctype);
		}
		doc.implementation = this;
		doc.childNodes = new NodeList();
		if(qualifiedName){
			var root = doc.createElementNS(namespaceURI,qualifiedName);
			doc.appendChild(root);
		}
		return doc;
	},
	// Introduced in DOM Level 2:
	createDocumentType:function(qualifiedName, publicId, systemId){// raises:INVALID_CHARACTER_ERR,NAMESPACE_ERR
		var node = new DocumentType();
		node.name = qualifiedName;
		node.nodeName = qualifiedName;
		node.publicId = publicId;
		node.systemId = systemId;
		// Introduced in DOM Level 2:
		//readonly attribute DOMString        internalSubset;
		
		//TODO:..
		//  readonly attribute NamedNodeMap     entities;
		//  readonly attribute NamedNodeMap     notations;
		return node;
	}
};


/**
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/core.html#ID-1950641247
 */

function Node() {
};

Node.prototype = {
	firstChild : null,
	lastChild : null,
	previousSibling : null,
	nextSibling : null,
	attributes : null,
	parentNode : null,
	childNodes : null,
	ownerDocument : null,
	nodeValue : null,
	namespaceURI : null,
	prefix : null,
	localName : null,
	// Modified in DOM Level 2:
	insertBefore:function(newChild, refChild){//raises 
		return _insertBefore(this,newChild,refChild);
	},
	replaceChild:function(newChild, oldChild){//raises 
		this.insertBefore(newChild,oldChild);
		if(oldChild){
			this.removeChild(oldChild);
		}
	},
	removeChild:function(oldChild){
		return _removeChild(this,oldChild);
	},
	appendChild:function(newChild){
		return this.insertBefore(newChild,null);
	},
	hasChildNodes:function(){
		return this.firstChild != null;
	},
	cloneNode:function(deep){
		return cloneNode(this.ownerDocument||this,this,deep);
	},
	// Modified in DOM Level 2:
	normalize:function(){
		var child = this.firstChild;
		while(child){
			var next = child.nextSibling;
			if(next && next.nodeType == TEXT_NODE && child.nodeType == TEXT_NODE){
				this.removeChild(next);
				child.appendData(next.data);
			}else{
				child.normalize();
				child = next;
			}
		}
	},
  	// Introduced in DOM Level 2:
	isSupported:function(feature, version){
		return this.ownerDocument.implementation.hasFeature(feature,version);
	},
    // Introduced in DOM Level 2:
    hasAttributes:function(){
    	return this.attributes.length>0;
    },
    lookupPrefix:function(namespaceURI){
    	var el = this;
    	while(el){
    		var map = el._nsMap;
    		//console.dir(map)
    		if(map){
    			for(var n in map){
    				if(map[n] == namespaceURI){
    					return n;
    				}
    			}
    		}
    		el = el.nodeType == 2?el.ownerDocument : el.parentNode;
    	}
    	return null;
    },
    // Introduced in DOM Level 3:
    lookupNamespaceURI:function(prefix){
    	var el = this;
    	while(el){
    		var map = el._nsMap;
    		//console.dir(map)
    		if(map){
    			if(prefix in map){
    				return map[prefix] ;
    			}
    		}
    		el = el.nodeType == 2?el.ownerDocument : el.parentNode;
    	}
    	return null;
    },
    // Introduced in DOM Level 3:
    isDefaultNamespace:function(namespaceURI){
    	var prefix = this.lookupPrefix(namespaceURI);
    	return prefix == null;
    }
};


function _xmlEncoder(c){
	return c == '<' && '&lt;' ||
         c == '>' && '&gt;' ||
         c == '&' && '&amp;' ||
         c == '"' && '&quot;' ||
         '&#'+c.charCodeAt()+';'
}


copy(NodeType,Node);
copy(NodeType,Node.prototype);

/**
 * @param callback return true for continue,false for break
 * @return boolean true: break visit;
 */
function _visitNode(node,callback){
	if(callback(node)){
		return true;
	}
	if(node = node.firstChild){
		do{
			if(_visitNode(node,callback)){return true}
        }while(node=node.nextSibling)
    }
}



function Document(){
}
function _onAddAttribute(doc,el,newAttr){
	doc && doc._inc++;
	var ns = newAttr.namespaceURI ;
	if(ns == 'http://www.w3.org/2000/xmlns/'){
		//update namespace
		el._nsMap[newAttr.prefix?newAttr.localName:''] = newAttr.value
	}
}
function _onRemoveAttribute(doc,el,newAttr,remove){
	doc && doc._inc++;
	var ns = newAttr.namespaceURI ;
	if(ns == 'http://www.w3.org/2000/xmlns/'){
		//update namespace
		delete el._nsMap[newAttr.prefix?newAttr.localName:'']
	}
}
function _onUpdateChild(doc,el,newChild){
	if(doc && doc._inc){
		doc._inc++;
		//update childNodes
		var cs = el.childNodes;
		if(newChild){
			cs[cs.length++] = newChild;
		}else{
			//console.log(1)
			var child = el.firstChild;
			var i = 0;
			while(child){
				cs[i++] = child;
				child =child.nextSibling;
			}
			cs.length = i;
		}
	}
}

/**
 * attributes;
 * children;
 * 
 * writeable properties:
 * nodeValue,Attr:value,CharacterData:data
 * prefix
 */
function _removeChild(parentNode,child){
	var previous = child.previousSibling;
	var next = child.nextSibling;
	if(previous){
		previous.nextSibling = next;
	}else{
		parentNode.firstChild = next
	}
	if(next){
		next.previousSibling = previous;
	}else{
		parentNode.lastChild = previous;
	}
	_onUpdateChild(parentNode.ownerDocument,parentNode);
	return child;
}
/**
 * preformance key(refChild == null)
 */
function _insertBefore(parentNode,newChild,nextChild){
	var cp = newChild.parentNode;
	if(cp){
		cp.removeChild(newChild);//remove and update
	}
	if(newChild.nodeType === DOCUMENT_FRAGMENT_NODE){
		var newFirst = newChild.firstChild;
		if (newFirst == null) {
			return newChild;
		}
		var newLast = newChild.lastChild;
	}else{
		newFirst = newLast = newChild;
	}
	var pre = nextChild ? nextChild.previousSibling : parentNode.lastChild;

	newFirst.previousSibling = pre;
	newLast.nextSibling = nextChild;
	
	
	if(pre){
		pre.nextSibling = newFirst;
	}else{
		parentNode.firstChild = newFirst;
	}
	if(nextChild == null){
		parentNode.lastChild = newLast;
	}else{
		nextChild.previousSibling = newLast;
	}
	do{
		newFirst.parentNode = parentNode;
	}while(newFirst !== newLast && (newFirst= newFirst.nextSibling))
	_onUpdateChild(parentNode.ownerDocument||parentNode,parentNode);
	//console.log(parentNode.lastChild.nextSibling == null)
	if (newChild.nodeType == DOCUMENT_FRAGMENT_NODE) {
		newChild.firstChild = newChild.lastChild = null;
	}
	return newChild;
}
function _appendSingleChild(parentNode,newChild){
	var cp = newChild.parentNode;
	if(cp){
		var pre = parentNode.lastChild;
		cp.removeChild(newChild);//remove and update
		var pre = parentNode.lastChild;
	}
	var pre = parentNode.lastChild;
	newChild.parentNode = parentNode;
	newChild.previousSibling = pre;
	newChild.nextSibling = null;
	if(pre){
		pre.nextSibling = newChild;
	}else{
		parentNode.firstChild = newChild;
	}
	parentNode.lastChild = newChild;
	_onUpdateChild(parentNode.ownerDocument,parentNode,newChild);
	return newChild;
	//console.log("__aa",parentNode.lastChild.nextSibling == null)
}
Document.prototype = {
	//implementation : null,
	nodeName :  '#document',
	nodeType :  DOCUMENT_NODE,
	doctype :  null,
	documentElement :  null,
	_inc : 1,
	
	insertBefore :  function(newChild, refChild){//raises 
		if(newChild.nodeType == DOCUMENT_FRAGMENT_NODE){
			var child = newChild.firstChild;
			while(child){
				var next = child.nextSibling;
				this.insertBefore(child,refChild);
				child = next;
			}
			return newChild;
		}
		if(this.documentElement == null && newChild.nodeType == 1){
			this.documentElement = newChild;
		}
		
		return _insertBefore(this,newChild,refChild),(newChild.ownerDocument = this),newChild;
	},
	removeChild :  function(oldChild){
		if(this.documentElement == oldChild){
			this.documentElement = null;
		}
		return _removeChild(this,oldChild);
	},
	// Introduced in DOM Level 2:
	importNode : function(importedNode,deep){
		return importNode(this,importedNode,deep);
	},
	// Introduced in DOM Level 2:
	getElementById :	function(id){
		var rtv = null;
		_visitNode(this.documentElement,function(node){
			if(node.nodeType == 1){
				if(node.getAttribute('id') == id){
					rtv = node;
					return true;
				}
			}
		})
		return rtv;
	},
	
	//document factory method:
	createElement :	function(tagName){
		var node = new Element();
		node.ownerDocument = this;
		node.nodeName = tagName;
		node.tagName = tagName;
		node.childNodes = new NodeList();
		var attrs	= node.attributes = new NamedNodeMap();
		attrs._ownerElement = node;
		return node;
	},
	createDocumentFragment :	function(){
		var node = new DocumentFragment();
		node.ownerDocument = this;
		node.childNodes = new NodeList();
		return node;
	},
	createTextNode :	function(data){
		var node = new Text();
		node.ownerDocument = this;
		node.appendData(data)
		return node;
	},
	createComment :	function(data){
		var node = new Comment();
		node.ownerDocument = this;
		node.appendData(data)
		return node;
	},
	createCDATASection :	function(data){
		var node = new CDATASection();
		node.ownerDocument = this;
		node.appendData(data)
		return node;
	},
	createProcessingInstruction :	function(target,data){
		var node = new ProcessingInstruction();
		node.ownerDocument = this;
		node.tagName = node.target = target;
		node.nodeValue= node.data = data;
		return node;
	},
	createAttribute :	function(name){
		var node = new Attr();
		node.ownerDocument	= this;
		node.name = name;
		node.nodeName	= name;
		node.localName = name;
		node.specified = true;
		return node;
	},
	createEntityReference :	function(name){
		var node = new EntityReference();
		node.ownerDocument	= this;
		node.nodeName	= name;
		return node;
	},
	// Introduced in DOM Level 2:
	createElementNS :	function(namespaceURI,qualifiedName){
		var node = new Element();
		var pl = qualifiedName.split(':');
		var attrs	= node.attributes = new NamedNodeMap();
		node.childNodes = new NodeList();
		node.ownerDocument = this;
		node.nodeName = qualifiedName;
		node.tagName = qualifiedName;
		node.namespaceURI = namespaceURI;
		if(pl.length == 2){
			node.prefix = pl[0];
			node.localName = pl[1];
		}else{
			//el.prefix = null;
			node.localName = qualifiedName;
		}
		attrs._ownerElement = node;
		return node;
	},
	// Introduced in DOM Level 2:
	createAttributeNS :	function(namespaceURI,qualifiedName){
		var node = new Attr();
		var pl = qualifiedName.split(':');
		node.ownerDocument = this;
		node.nodeName = qualifiedName;
		node.name = qualifiedName;
		node.namespaceURI = namespaceURI;
		node.specified = true;
		if(pl.length == 2){
			node.prefix = pl[0];
			node.localName = pl[1];
		}else{
			//el.prefix = null;
			node.localName = qualifiedName;
		}
		return node;
	}
};
_extends(Document,Node);


function Element() {
	this._nsMap = {};
};
Element.prototype = {
	nodeType : ELEMENT_NODE,
	hasAttribute : function(name){
		return this.getAttributeNode(name)!=null;
	},
	getAttribute : function(name){
		var attr = this.getAttributeNode(name);
		return attr && attr.value || '';
	},
	getAttributeNode : function(name){
		return this.attributes.getNamedItem(name);
	},
	setAttribute : function(name, value){
		var attr = this.ownerDocument.createAttribute(name);
		attr.value = attr.nodeValue = "" + value;
		this.setAttributeNode(attr)
	},
	removeAttribute : function(name){
		var attr = this.getAttributeNode(name)
		attr && this.removeAttributeNode(attr);
	},
	
	//four real opeartion method
	appendChild:function(newChild){
		if(newChild.nodeType === DOCUMENT_FRAGMENT_NODE){
			return this.insertBefore(newChild,null);
		}else{
			return _appendSingleChild(this,newChild);
		}
	},
	setAttributeNode : function(newAttr){
		return this.attributes.setNamedItem(newAttr);
	},
	setAttributeNodeNS : function(newAttr){
		return this.attributes.setNamedItemNS(newAttr);
	},
	removeAttributeNode : function(oldAttr){
		return this.attributes.removeNamedItem(oldAttr.nodeName);
	},
	//get real attribute name,and remove it by removeAttributeNode
	removeAttributeNS : function(namespaceURI, localName){
		var old = this.getAttributeNodeNS(namespaceURI, localName);
		old && this.removeAttributeNode(old);
	},
	
	hasAttributeNS : function(namespaceURI, localName){
		return this.getAttributeNodeNS(namespaceURI, localName)!=null;
	},
	getAttributeNS : function(namespaceURI, localName){
		var attr = this.getAttributeNodeNS(namespaceURI, localName);
		return attr && attr.value || '';
	},
	setAttributeNS : function(namespaceURI, qualifiedName, value){
		var attr = this.ownerDocument.createAttributeNS(namespaceURI, qualifiedName);
		attr.value = attr.nodeValue = value;
		this.setAttributeNode(attr)
	},
	getAttributeNodeNS : function(namespaceURI, localName){
		return this.attributes.getNamedItemNS(namespaceURI, localName);
	},
	
	getElementsByTagName : function(tagName){
		return new LiveNodeList(this,function(base){
			var ls = [];
			_visitNode(base,function(node){
				if(node !== base && node.nodeType == ELEMENT_NODE && (tagName === '*' || node.tagName == tagName)){
					ls.push(node);
				}
			});
			return ls;
		});
	},
	getElementsByTagNameNS : function(namespaceURI, localName){
		return new LiveNodeList(this,function(base){
			var ls = [];
			_visitNode(base,function(node){
				if(node !== base && node.nodeType === ELEMENT_NODE && node.namespaceURI === namespaceURI && (localName === '*' || node.localName == localName)){
					ls.push(node);
				}
			});
			return ls;
		});
	}
};
Document.prototype.getElementsByTagName = Element.prototype.getElementsByTagName;
Document.prototype.getElementsByTagNameNS = Element.prototype.getElementsByTagNameNS;


_extends(Element,Node);
function Attr() {
};
Attr.prototype.nodeType = ATTRIBUTE_NODE;
_extends(Attr,Node);


function CharacterData() {
};
CharacterData.prototype = {
	data : '',
	substringData : function(offset, count) {
		return this.data.substring(offset, offset+count);
	},
	appendData: function(text) {
		text = this.data+text;
		this.nodeValue = this.data = text;
		this.length = text.length;
	},
	insertData: function(offset,text) {
		this.replaceData(offset,0,text);
	
	},
	appendChild:function(newChild){
		//if(!(newChild instanceof CharacterData)){
			throw new Error(ExceptionMessage[3])
		//}
		return Node.prototype.appendChild.apply(this,arguments)
	},
	deleteData: function(offset, count) {
		this.replaceData(offset,count,"");
	},
	replaceData: function(offset, count, text) {
		var start = this.data.substring(0,offset);
		var end = this.data.substring(offset+count);
		text = start + text + end;
		this.nodeValue = this.data = text;
		this.length = text.length;
	}
}
_extends(CharacterData,Node);
function Text() {
};
Text.prototype = {
	nodeName : "#text",
	nodeType : TEXT_NODE,
	splitText : function(offset) {
		var text = this.data;
		var newText = text.substring(offset);
		text = text.substring(0, offset);
		this.data = this.nodeValue = text;
		this.length = text.length;
		var newNode = this.ownerDocument.createTextNode(newText);
		if(this.parentNode){
			this.parentNode.insertBefore(newNode, this.nextSibling);
		}
		return newNode;
	}
}
_extends(Text,CharacterData);
function Comment() {
};
Comment.prototype = {
	nodeName : "#comment",
	nodeType : COMMENT_NODE
}
_extends(Comment,CharacterData);

function CDATASection() {
};
CDATASection.prototype = {
	nodeName : "#cdata-section",
	nodeType : CDATA_SECTION_NODE
}
_extends(CDATASection,CharacterData);


function DocumentType() {
};
DocumentType.prototype.nodeType = DOCUMENT_TYPE_NODE;
_extends(DocumentType,Node);

function Notation() {
};
Notation.prototype.nodeType = NOTATION_NODE;
_extends(Notation,Node);

function Entity() {
};
Entity.prototype.nodeType = ENTITY_NODE;
_extends(Entity,Node);

function EntityReference() {
};
EntityReference.prototype.nodeType = ENTITY_REFERENCE_NODE;
_extends(EntityReference,Node);

function DocumentFragment() {
};
DocumentFragment.prototype.nodeName =	"#document-fragment";
DocumentFragment.prototype.nodeType =	DOCUMENT_FRAGMENT_NODE;
_extends(DocumentFragment,Node);


function ProcessingInstruction() {
}
ProcessingInstruction.prototype.nodeType = PROCESSING_INSTRUCTION_NODE;
_extends(ProcessingInstruction,Node);
function XMLSerializer(){}
XMLSerializer.prototype.serializeToString = function(node){
	var buf = [];
	serializeToString(node,buf);
	return buf.join('');
}
Node.prototype.toString =function(){
	return XMLSerializer.prototype.serializeToString(this);
}
function serializeToString(node,buf){
	switch(node.nodeType){
	case ELEMENT_NODE:
		var attrs = node.attributes;
		var len = attrs.length;
		var child = node.firstChild;
		var nodeName = node.tagName;
		var isHTML = htmlns === node.namespaceURI
		buf.push('<',nodeName);
		for(var i=0;i<len;i++){
			serializeToString(attrs.item(i),buf,isHTML);
		}
		if(child || isHTML && !/^(?:meta|link|img|br|hr|input)$/i.test(nodeName)){
			buf.push('>');
			//if is cdata child node
			if(isHTML && /^script$/i.test(nodeName)){
				if(child){
					buf.push(child.data);
				}
			}else{
				while(child){
					serializeToString(child,buf);
					child = child.nextSibling;
				}
			}
			buf.push('</',nodeName,'>');
		}else{
			buf.push('/>');
		}
		return;
	case DOCUMENT_NODE:
	case DOCUMENT_FRAGMENT_NODE:
		var child = node.firstChild;
		while(child){
			serializeToString(child,buf);
			child = child.nextSibling;
		}
		return;
	case ATTRIBUTE_NODE:
		return buf.push(' ',node.name,'="',node.value.replace(/[<&"]/g,_xmlEncoder),'"');
	case TEXT_NODE:
		return buf.push(node.data.replace(/[<&]/g,_xmlEncoder));
	case CDATA_SECTION_NODE:
		return buf.push( '<![CDATA[',node.data,']]>');
	case COMMENT_NODE:
		return buf.push( "<!--",node.data,"-->");
	case DOCUMENT_TYPE_NODE:
		var pubid = node.publicId;
		var sysid = node.systemId;
		buf.push('<!DOCTYPE ',node.name);
		if(pubid){
			buf.push(' PUBLIC "',pubid);
			if (sysid && sysid!='.') {
				buf.push( '" "',sysid);
			}
			buf.push('">');
		}else if(sysid && sysid!='.'){
			buf.push(' SYSTEM "',sysid,'">');
		}else{
			var sub = node.internalSubset;
			if(sub){
				buf.push(" [",sub,"]");
			}
			buf.push(">");
		}
		return;
	case PROCESSING_INSTRUCTION_NODE:
		return buf.push( "<?",node.target," ",node.data,"?>");
	case ENTITY_REFERENCE_NODE:
		return buf.push( '&',node.nodeName,';');
	//case ENTITY_NODE:
	//case NOTATION_NODE:
	default:
		buf.push('??',node.nodeName);
	}
}
function importNode(doc,node,deep){
	var node2;
	switch (node.nodeType) {
	case ELEMENT_NODE:
		node2 = node.cloneNode(false);
		node2.ownerDocument = doc;
		//var attrs = node2.attributes;
		//var len = attrs.length;
		//for(var i=0;i<len;i++){
			//node2.setAttributeNodeNS(importNode(doc,attrs.item(i),deep));
		//}
	case DOCUMENT_FRAGMENT_NODE:
		break;
	case ATTRIBUTE_NODE:
		deep = true;
		break;
	//case ENTITY_REFERENCE_NODE:
	//case PROCESSING_INSTRUCTION_NODE:
	////case TEXT_NODE:
	//case CDATA_SECTION_NODE:
	//case COMMENT_NODE:
	//	deep = false;
	//	break;
	//case DOCUMENT_NODE:
	//case DOCUMENT_TYPE_NODE:
	//cannot be imported.
	//case ENTITY_NODE:
	//case NOTATION_NODE：
	//can not hit in level3
	//default:throw e;
	}
	if(!node2){
		node2 = node.cloneNode(false);//false
	}
	node2.ownerDocument = doc;
	node2.parentNode = null;
	if(deep){
		var child = node.firstChild;
		while(child){
			node2.appendChild(importNode(doc,child,deep));
			child = child.nextSibling;
		}
	}
	return node2;
}
//
//var _relationMap = {firstChild:1,lastChild:1,previousSibling:1,nextSibling:1,
//					attributes:1,childNodes:1,parentNode:1,documentElement:1,doctype,};
function cloneNode(doc,node,deep){
	var node2 = new node.constructor();
	for(var n in node){
		var v = node[n];
		if(typeof v != 'object' ){
			if(v != node2[n]){
				node2[n] = v;
			}
		}
	}
	if(node.childNodes){
		node2.childNodes = new NodeList();
	}
	node2.ownerDocument = doc;
	switch (node2.nodeType) {
	case ELEMENT_NODE:
		var attrs	= node.attributes;
		var attrs2	= node2.attributes = new NamedNodeMap();
		var len = attrs.length
		attrs2._ownerElement = node2;
		for(var i=0;i<len;i++){
			node2.setAttributeNode(cloneNode(doc,attrs.item(i),true));
		}
		break;;
	case ATTRIBUTE_NODE:
		deep = true;
	}
	if(deep){
		var child = node.firstChild;
		while(child){
			node2.appendChild(cloneNode(doc,child,deep));
			child = child.nextSibling;
		}
	}
	return node2;
}

function __set__(object,key,value){
	object[key] = value
}
//do dynamic
try{
	if(Object.defineProperty){
		Object.defineProperty(LiveNodeList.prototype,'length',{
			get:function(){
				_updateLiveList(this);
				return this.$$length;
			}
		});
		Object.defineProperty(Node.prototype,'textContent',{
			get:function(){
				return getTextContent(this);
			},
			set:function(data){
				switch(this.nodeType){
				case 1:
				case 11:
					while(this.firstChild){
						this.removeChild(this.firstChild);
					}
					if(data || String(data)){
						this.appendChild(this.ownerDocument.createTextNode(data));
					}
					break;
				default:
					//TODO:
					this.data = data;
					this.value = value;
					this.nodeValue = data;
				}
			}
		})
		
		function getTextContent(node){
			switch(node.nodeType){
			case 1:
			case 11:
				var buf = [];
				node = node.firstChild;
				while(node){
					if(node.nodeType!==7 && node.nodeType !==8){
						buf.push(getTextContent(node));
					}
					node = node.nextSibling;
				}
				return buf.join('');
			default:
				return node.nodeValue;
			}
		}
		__set__ = function(object,key,value){
			//console.log(value)
			object['$$'+key] = value
		}
	}
}catch(e){//ie8
}

if(typeof require == 'function'){
	exports.DOMImplementation = DOMImplementation;
	exports.XMLSerializer = XMLSerializer;
}

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/..\\node_modules\\xmldom\\dom.js","/..\\node_modules\\xmldom")
},{"VCmEsw":4,"buffer":1}],7:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
//[4]   	NameStartChar	   ::=   	":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
//[4a]   	NameChar	   ::=   	NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
//[5]   	Name	   ::=   	NameStartChar (NameChar)*
var nameStartChar = /[A-Z_a-z\xC0-\xD6\xD8-\xF6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]///\u10000-\uEFFFF
var nameChar = new RegExp("[\\-\\.0-9"+nameStartChar.source.slice(1,-1)+"\u00B7\u0300-\u036F\\ux203F-\u2040]");
var tagNamePattern = new RegExp('^'+nameStartChar.source+nameChar.source+'*(?:\:'+nameStartChar.source+nameChar.source+'*)?$');
//var tagNamePattern = /^[a-zA-Z_][\w\-\.]*(?:\:[a-zA-Z_][\w\-\.]*)?$/
//var handlers = 'resolveEntity,getExternalSubset,characters,endDocument,endElement,endPrefixMapping,ignorableWhitespace,processingInstruction,setDocumentLocator,skippedEntity,startDocument,startElement,startPrefixMapping,notationDecl,unparsedEntityDecl,error,fatalError,warning,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,comment,endCDATA,endDTD,endEntity,startCDATA,startDTD,startEntity'.split(',')

//S_TAG,	S_ATTR,	S_EQ,	S_V
//S_ATTR_S,	S_E,	S_S,	S_C
var S_TAG = 0;//tag name offerring
var S_ATTR = 1;//attr name offerring 
var S_ATTR_S=2;//attr name end and space offer
var S_EQ = 3;//=space?
var S_V = 4;//attr value(no quot value only)
var S_E = 5;//attr value end and no space(quot end)
var S_S = 6;//(attr value end || tag end ) && (space offer)
var S_C = 7;//closed el<el />

function XMLReader(){
	
}

XMLReader.prototype = {
	parse:function(source,defaultNSMap,entityMap){
		var domBuilder = this.domBuilder;
		domBuilder.startDocument();
		_copy(defaultNSMap ,defaultNSMap = {})
		parse(source,defaultNSMap,entityMap,
				domBuilder,this.errorHandler);
		domBuilder.endDocument();
	}
}
function parse(source,defaultNSMapCopy,entityMap,domBuilder,errorHandler){
  function fixedFromCharCode(code) {
		// String.prototype.fromCharCode does not supports
		// > 2 bytes unicode chars directly
		if (code > 0xffff) {
			code -= 0x10000;
			var surrogate1 = 0xd800 + (code >> 10)
				, surrogate2 = 0xdc00 + (code & 0x3ff);

			return String.fromCharCode(surrogate1, surrogate2);
		} else {
			return String.fromCharCode(code);
		}
	}
	function entityReplacer(a){
		var k = a.slice(1,-1);
		if(k in entityMap){
			return entityMap[k]; 
		}else if(k.charAt(0) === '#'){
			return fixedFromCharCode(parseInt(k.substr(1).replace('x','0x')))
		}else{
			errorHandler.error('entity not found:'+a);
			return a;
		}
	}
	function appendText(end){//has some bugs
		var xt = source.substring(start,end).replace(/&#?\w+;/g,entityReplacer);
		locator&&position(start);
		domBuilder.characters(xt,0,end-start);
		start = end
	}
	function position(start,m){
		while(start>=endPos && (m = linePattern.exec(source))){
			startPos = m.index;
			endPos = startPos + m[0].length;
			locator.lineNumber++;
			//console.log('line++:',locator,startPos,endPos)
		}
		locator.columnNumber = start-startPos+1;
	}
	var startPos = 0;
	var endPos = 0;
	var linePattern = /.+(?:\r\n?|\n)|.*$/g
	var locator = domBuilder.locator;
	
	var parseStack = [{currentNSMap:defaultNSMapCopy}]
	var closeMap = {};
	var start = 0;
	while(true){
		var i = source.indexOf('<',start);
		if(i<0){
			if(!source.substr(start).match(/^\s*$/)){
				var doc = domBuilder.document;
    			var text = doc.createTextNode(source.substr(start));
    			doc.appendChild(text);
    			domBuilder.currentElement = text;
			}
			return;
		}
		if(i>start){
			appendText(i);
		}
		switch(source.charAt(i+1)){
		case '/':
			var end = source.indexOf('>',i+3);
			var tagName = source.substring(i+2,end);
			var config = parseStack.pop();
			var localNSMap = config.localNSMap;
			
	        if(config.tagName != tagName){
	            errorHandler.fatalError("end tag name: "+tagName+' is not match the current start tagName:'+config.tagName );
	        }
			domBuilder.endElement(config.uri,config.localName,tagName);
			if(localNSMap){
				for(var prefix in localNSMap){
					domBuilder.endPrefixMapping(prefix) ;
				}
			}
			end++;
			break;
			// end elment
		case '?':// <?...?>
			locator&&position(i);
			end = parseInstruction(source,i,domBuilder);
			break;
		case '!':// <!doctype,<![CDATA,<!--
			locator&&position(i);
			end = parseDCC(source,i,domBuilder,errorHandler);
			break;
		default:
			try{
				locator&&position(i);
				
				var el = new ElementAttributes();
				
				//elStartEnd
				var end = parseElementStartPart(source,i,el,entityReplacer,errorHandler);
				var len = el.length;
				//position fixed
				if(len && locator){
					var backup = copyLocator(locator,{});
					for(var i = 0;i<len;i++){
						var a = el[i];
						position(a.offset);
						a.offset = copyLocator(locator,{});
					}
					copyLocator(backup,locator);
				}
				if(!el.closed && fixSelfClosed(source,end,el.tagName,closeMap)){
					el.closed = true;
					if(!entityMap.nbsp){
						errorHandler.warning('unclosed xml attribute');
					}
				}
				appendElement(el,domBuilder,parseStack);
				
				
				if(el.uri === 'http://www.w3.org/1999/xhtml' && !el.closed){
					end = parseHtmlSpecialContent(source,end,el.tagName,entityReplacer,domBuilder)
				}else{
					end++;
				}
			}catch(e){
				errorHandler.error('element parse error: '+e);
				end = -1;
			}

		}
		if(end<0){
			//TODO: 这里有可能sax回退，有位置错误风险
			appendText(i+1);
		}else{
			start = end;
		}
	}
}
function copyLocator(f,t){
	t.lineNumber = f.lineNumber;
	t.columnNumber = f.columnNumber;
	return t;
	
}

/**
 * @see #appendElement(source,elStartEnd,el,selfClosed,entityReplacer,domBuilder,parseStack);
 * @return end of the elementStartPart(end of elementEndPart for selfClosed el)
 */
function parseElementStartPart(source,start,el,entityReplacer,errorHandler){
	var attrName;
	var value;
	var p = ++start;
	var s = S_TAG;//status
	while(true){
		var c = source.charAt(p);
		switch(c){
		case '=':
			if(s === S_ATTR){//attrName
				attrName = source.slice(start,p);
				s = S_EQ;
			}else if(s === S_ATTR_S){
				s = S_EQ;
			}else{
				//fatalError: equal must after attrName or space after attrName
				throw new Error('attribute equal must after attrName');
			}
			break;
		case '\'':
		case '"':
			if(s === S_EQ){//equal
				start = p+1;
				p = source.indexOf(c,start)
				if(p>0){
					value = source.slice(start,p).replace(/&#?\w+;/g,entityReplacer);
					el.add(attrName,value,start-1);
					s = S_E;
				}else{
					//fatalError: no end quot match
					throw new Error('attribute value no end \''+c+'\' match');
				}
			}else if(s == S_V){
				value = source.slice(start,p).replace(/&#?\w+;/g,entityReplacer);
				//console.log(attrName,value,start,p)
				el.add(attrName,value,start);
				//console.dir(el)
				errorHandler.warning('attribute "'+attrName+'" missed start quot('+c+')!!');
				start = p+1;
				s = S_E
			}else{
				//fatalError: no equal before
				throw new Error('attribute value must after "="');
			}
			break;
		case '/':
			switch(s){
			case S_TAG:
				el.setTagName(source.slice(start,p));
			case S_E:
			case S_S:
			case S_C:
				s = S_C;
				el.closed = true;
			case S_V:
			case S_ATTR:
			case S_ATTR_S:
				break;
			//case S_EQ:
			default:
				throw new Error("attribute invalid close char('/')")
			}
			break;
		case ''://end document
			//throw new Error('unexpected end of input')
			errorHandler.error('unexpected end of input');
		case '>':
			switch(s){
			case S_TAG:
				el.setTagName(source.slice(start,p));
			case S_E:
			case S_S:
			case S_C:
				break;//normal
			case S_V://Compatible state
			case S_ATTR:
				value = source.slice(start,p);
				if(value.slice(-1) === '/'){
					el.closed  = true;
					value = value.slice(0,-1)
				}
			case S_ATTR_S:
				if(s === S_ATTR_S){
					value = attrName;
				}
				if(s == S_V){
					errorHandler.warning('attribute "'+value+'" missed quot(")!!');
					el.add(attrName,value.replace(/&#?\w+;/g,entityReplacer),start)
				}else{
					errorHandler.warning('attribute "'+value+'" missed value!! "'+value+'" instead!!')
					el.add(value,value,start)
				}
				break;
			case S_EQ:
				throw new Error('attribute value missed!!');
			}
//			console.log(tagName,tagNamePattern,tagNamePattern.test(tagName))
			return p;
		/*xml space '\x20' | #x9 | #xD | #xA; */
		case '\u0080':
			c = ' ';
		default:
			if(c<= ' '){//space
				switch(s){
				case S_TAG:
					el.setTagName(source.slice(start,p));//tagName
					s = S_S;
					break;
				case S_ATTR:
					attrName = source.slice(start,p)
					s = S_ATTR_S;
					break;
				case S_V:
					var value = source.slice(start,p).replace(/&#?\w+;/g,entityReplacer);
					errorHandler.warning('attribute "'+value+'" missed quot(")!!');
					el.add(attrName,value,start)
				case S_E:
					s = S_S;
					break;
				//case S_S:
				//case S_EQ:
				//case S_ATTR_S:
				//	void();break;
				//case S_C:
					//ignore warning
				}
			}else{//not space
//S_TAG,	S_ATTR,	S_EQ,	S_V
//S_ATTR_S,	S_E,	S_S,	S_C
				switch(s){
				//case S_TAG:void();break;
				//case S_ATTR:void();break;
				//case S_V:void();break;
				case S_ATTR_S:
					errorHandler.warning('attribute "'+attrName+'" missed value!! "'+attrName+'" instead!!')
					el.add(attrName,attrName,start);
					start = p;
					s = S_ATTR;
					break;
				case S_E:
					errorHandler.warning('attribute space is required"'+attrName+'"!!')
				case S_S:
					s = S_ATTR;
					start = p;
					break;
				case S_EQ:
					s = S_V;
					start = p;
					break;
				case S_C:
					throw new Error("elements closed character '/' and '>' must be connected to");
				}
			}
		}
		p++;
	}
}
/**
 * @return end of the elementStartPart(end of elementEndPart for selfClosed el)
 */
function appendElement(el,domBuilder,parseStack){
	var tagName = el.tagName;
	var localNSMap = null;
	var currentNSMap = parseStack[parseStack.length-1].currentNSMap;
	var i = el.length;
	while(i--){
		var a = el[i];
		var qName = a.qName;
		var value = a.value;
		var nsp = qName.indexOf(':');
		if(nsp>0){
			var prefix = a.prefix = qName.slice(0,nsp);
			var localName = qName.slice(nsp+1);
			var nsPrefix = prefix === 'xmlns' && localName
		}else{
			localName = qName;
			prefix = null
			nsPrefix = qName === 'xmlns' && ''
		}
		//can not set prefix,because prefix !== ''
		a.localName = localName ;
		//prefix == null for no ns prefix attribute 
		if(nsPrefix !== false){//hack!!
			if(localNSMap == null){
				localNSMap = {}
				//console.log(currentNSMap,0)
				_copy(currentNSMap,currentNSMap={})
				//console.log(currentNSMap,1)
			}
			currentNSMap[nsPrefix] = localNSMap[nsPrefix] = value;
			a.uri = 'http://www.w3.org/2000/xmlns/'
			domBuilder.startPrefixMapping(nsPrefix, value) 
		}
	}
	var i = el.length;
	while(i--){
		a = el[i];
		var prefix = a.prefix;
		if(prefix){//no prefix attribute has no namespace
			if(prefix === 'xml'){
				a.uri = 'http://www.w3.org/XML/1998/namespace';
			}if(prefix !== 'xmlns'){
				a.uri = currentNSMap[prefix]
				
				//{console.log('###'+a.qName,domBuilder.locator.systemId+'',currentNSMap,a.uri)}
			}
		}
	}
	var nsp = tagName.indexOf(':');
	if(nsp>0){
		prefix = el.prefix = tagName.slice(0,nsp);
		localName = el.localName = tagName.slice(nsp+1);
	}else{
		prefix = null;//important!!
		localName = el.localName = tagName;
	}
	//no prefix element has default namespace
	var ns = el.uri = currentNSMap[prefix || ''];
	domBuilder.startElement(ns,localName,tagName,el);
	//endPrefixMapping and startPrefixMapping have not any help for dom builder
	//localNSMap = null
	if(el.closed){
		domBuilder.endElement(ns,localName,tagName);
		if(localNSMap){
			for(prefix in localNSMap){
				domBuilder.endPrefixMapping(prefix) 
			}
		}
	}else{
		el.currentNSMap = currentNSMap;
		el.localNSMap = localNSMap;
		parseStack.push(el);
	}
}
function parseHtmlSpecialContent(source,elStartEnd,tagName,entityReplacer,domBuilder){
	if(/^(?:script|textarea)$/i.test(tagName)){
		var elEndStart =  source.indexOf('</'+tagName+'>',elStartEnd);
		var text = source.substring(elStartEnd+1,elEndStart);
		if(/[&<]/.test(text)){
			if(/^script$/i.test(tagName)){
				//if(!/\]\]>/.test(text)){
					//lexHandler.startCDATA();
					domBuilder.characters(text,0,text.length);
					//lexHandler.endCDATA();
					return elEndStart;
				//}
			}//}else{//text area
				text = text.replace(/&#?\w+;/g,entityReplacer);
				domBuilder.characters(text,0,text.length);
				return elEndStart;
			//}
			
		}
	}
	return elStartEnd+1;
}
function fixSelfClosed(source,elStartEnd,tagName,closeMap){
	//if(tagName in closeMap){
	var pos = closeMap[tagName];
	if(pos == null){
		//console.log(tagName)
		pos = closeMap[tagName] = source.lastIndexOf('</'+tagName+'>')
	}
	return pos<elStartEnd;
	//} 
}
function _copy(source,target){
	for(var n in source){target[n] = source[n]}
}
function parseDCC(source,start,domBuilder,errorHandler){//sure start with '<!'
	var next= source.charAt(start+2)
	switch(next){
	case '-':
		if(source.charAt(start + 3) === '-'){
			var end = source.indexOf('-->',start+4);
			//append comment source.substring(4,end)//<!--
			if(end>start){
				domBuilder.comment(source,start+4,end-start-4);
				return end+3;
			}else{
				errorHandler.error("Unclosed comment");
				return -1;
			}
		}else{
			//error
			return -1;
		}
	default:
		if(source.substr(start+3,6) == 'CDATA['){
			var end = source.indexOf(']]>',start+9);
			domBuilder.startCDATA();
			domBuilder.characters(source,start+9,end-start-9);
			domBuilder.endCDATA() 
			return end+3;
		}
		//<!DOCTYPE
		//startDTD(java.lang.String name, java.lang.String publicId, java.lang.String systemId) 
		var matchs = split(source,start);
		var len = matchs.length;
		if(len>1 && /!doctype/i.test(matchs[0][0])){
			var name = matchs[1][0];
			var pubid = len>3 && /^public$/i.test(matchs[2][0]) && matchs[3][0]
			var sysid = len>4 && matchs[4][0];
			var lastMatch = matchs[len-1]
			domBuilder.startDTD(name,pubid && pubid.replace(/^(['"])(.*?)\1$/,'$2'),
					sysid && sysid.replace(/^(['"])(.*?)\1$/,'$2'));
			domBuilder.endDTD();
			
			return lastMatch.index+lastMatch[0].length
		}
	}
	return -1;
}



function parseInstruction(source,start,domBuilder){
	var end = source.indexOf('?>',start);
	if(end){
		var match = source.substring(start,end).match(/^<\?(\S*)\s*([\s\S]*?)\s*$/);
		if(match){
			var len = match[0].length;
			domBuilder.processingInstruction(match[1], match[2]) ;
			return end+2;
		}else{//error
			return -1;
		}
	}
	return -1;
}

/**
 * @param source
 */
function ElementAttributes(source){
	
}
ElementAttributes.prototype = {
	setTagName:function(tagName){
		if(!tagNamePattern.test(tagName)){
			throw new Error('invalid tagName:'+tagName)
		}
		this.tagName = tagName
	},
	add:function(qName,value,offset){
		if(!tagNamePattern.test(qName)){
			throw new Error('invalid attribute:'+qName)
		}
		this[this.length++] = {qName:qName,value:value,offset:offset}
	},
	length:0,
	getLocalName:function(i){return this[i].localName},
	getOffset:function(i){return this[i].offset},
	getQName:function(i){return this[i].qName},
	getURI:function(i){return this[i].uri},
	getValue:function(i){return this[i].value}
//	,getIndex:function(uri, localName)){
//		if(localName){
//			
//		}else{
//			var qName = uri
//		}
//	},
//	getValue:function(){return this.getValue(this.getIndex.apply(this,arguments))},
//	getType:function(uri,localName){}
//	getType:function(i){},
}




function _set_proto_(thiz,parent){
	thiz.__proto__ = parent;
	return thiz;
}
if(!(_set_proto_({},_set_proto_.prototype) instanceof _set_proto_)){
	_set_proto_ = function(thiz,parent){
		function p(){};
		p.prototype = parent;
		p = new p();
		for(parent in thiz){
			p[parent] = thiz[parent];
		}
		return p;
	}
}

function split(source,start){
	var match;
	var buf = [];
	var reg = /'[^']+'|"[^"]+"|[^\s<>\/=]+=?|(\/?\s*>|<)/g;
	reg.lastIndex = start;
	reg.exec(source);//skip <
	while(match = reg.exec(source)){
		buf.push(match);
		if(match[1])return buf;
	}
}

if(typeof require == 'function'){
	exports.XMLReader = XMLReader;
}


}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/..\\node_modules\\xmldom\\sax.js","/..\\node_modules\\xmldom")
},{"VCmEsw":4,"buffer":1}],8:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/**
 * GPXファイル操作のページ用のJavaScript
 * @copyright 2015 YuTanaka
 * @license MIT
 */

var gpxtrim = require('./gpx-trimmer');
var strGPX = "";
var fileGPX = "";
var rangeGPX = {};

// イベント設定
$('#fileGpx').change(changeFile);
$('submit').click(submitGpx);

/** SUBMITボタン*/
function submitGpx() {
  var result;

  if (strGPX.length === 0) {
    alert('GPXファイルを選択してください。');
    return ;
  }

  // 変換
  var dtst = Date.parse($('#textStart').val());
  var dted = Date.parse($('#textEnd').val());

  // 空欄
  if (isNaN(dtst)) {
    dtst = rangeGPX.first.getTime();
  }
  if (isNaN(dted)) {
    dted = rangeGPX.last.getTime();
  }
  // 入れ替えチェック
  if (dtst > dted) {
    alert("開始日時の方が、終了日時より後の時間になっています。");
    return;
  }
  // 開始時間がGPXより遅い
  if (dtst > rangeGPX.last.getTime()) {
    alert("開始日時がGPXの時間を過ぎています。");
    return;
  }
  // 終了時間がGPXより早い
  if (dted < rangeGPX.first.getTime()) {
    alert('終了日時がGPXの開始時間より早くなっています。');
    return;
  }

  // 変換実行
  result = gpxtrim.trim(strGPX, new Date(dtst), new Date(dted));
  // 結果表示
  $('#resultst').html(gpxtrim.getStatus().replace(/\n/g, "<br/>"));
  // ダウンロード
  downloadGPX(result);
}

/** GPXをダウンロードする*/
function downloadGPX(result){
  var blob = new Blob([result],{type:'text/xml'});
  var $btn = $('#btnDownload');
  $btn.attr('href',URL.createObjectURL(blob));
  $btn.attr('target','_blank');
  $btn.attr('download',fileGPX.name);
  $btn.text("変換したGPXファイルをダウンロード");
}


/** ファイル設定*/
function changeFile() {
  // 機能チェック
  if (!(window.File && window.FileReader && window.FileList && window.Blob)) {
    // 初期化
    clearFile();
    alert('The File APIs are not fully supported in this browser.');
  }

  // ファイル取得
  fileGPX = $(this).prop('files')[0];
  var reader = new FileReader();
  reader.onload = (function(fdata) {
    return function(e) {
      strGPX = e.target.result;
      if (!gpxtrim.validGPX(strGPX)) {
        clearFile();
        alert("指定したファイルがGPXファイルとして認識できませんでした。UTF-8NのGPXファイルを指定してください。");
        return;
      }
      detectGPX(strGPX);
    };
  })(fileGPX);

  // 読み込み開始
  reader.readAsText(fileGPX);
}

/** 読み込んだファイルを解放する*/
function clearFile() {
  strGPX = "";
  fileGPX = "";
  rangeGPX = {};
  $('#btnDownload').text("");
  $('#resultst').text("");
  $('#gpxstatus').text("");
  $('#textStart').val("");
  $('#textEnd').val("");
  // ファイルをリセット
  $('#fileGpx').unbind();
  $('#phFile').html($('#phFile').html());
  $('#fileGpx').change(changeFile);
}

/** GPXファイルの開始と終了時間を読み取って、ページに反映させる*/
function detectGPX(data) {
  rangeGPX = gpxtrim.getTime(data);
  $('#gpxstatus').html("開始日時:"+strDate(rangeGPX.first)+"<br/>終了日時:"+strDate(rangeGPX.last));
  $('#textStart').val(strDate(rangeGPX.first));
  $('#textEnd').val(strDate(rangeGPX.last));
}

function strDate(dt) {
  return ""+dt.getFullYear()+"/"+(dt.getMonth()+1)+"/"+dt.getDate()+" "+dt.getHours()+":"+dt.getMinutes()+":"+dt.getSeconds();
}

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/fake_ca4a6a62.js","/")
},{"./gpx-trimmer":9,"VCmEsw":4,"buffer":1}],9:[function(require,module,exports){
(function (process,global,Buffer,__argument0,__argument1,__argument2,__argument3,__filename,__dirname){
/**
 * GPXの整理を行うライブラリ
 */
var DOMParser = require('xmldom').DOMParser;

/**
 * 前回の処理結果を記録
 */
var lastStatus = "";

exports.getStatus = function() {
  return lastStatus;
};

/** 指定の文字列がGPXとして解釈できるかを確認する
 * @param string gpx 読み込んだGPX文字列
 * @return true=問題なし / false=エラー。getStatus()で結果を読み取れる
 */
exports.validGPX = function(gpx) {
  var doc = new DOMParser().parseFromString(gpx, "application/xml");
  return (doc.getElementsByTagName('gpx').length > 0);
}

/**
 * trksegタグを削除
 * @param string gpx GPX文字列
 * @return string タグを削除した後のGPXを文字列で返す。失敗時はfalseを返す
 */
exports.removeSegment = function (gpx) {
  var parser = new DOMParser();
  var segs;
  var clone = "";
  var segchilds = "";
  var doc = parser.parseFromString(gpx, "application/xml");
  segs = doc.getElementsByTagName('trkseg');

  // チェック
  if (!exports.validGPX(gpx)) {
    return false;
  }

  // 不要なtrksegを削除
  for (var i=1 ; i<segs.length ; ) {
    for (var j=0 ; j<segs[1].childNodes.length ; j++) {
      segs[0].appendChild(segs[1].childNodes[j].cloneNode(true));
    }
    // コピーしたセグメントを削除
    segs[1].parentNode.removeChild(segs[1]);
  }

  // 不要な項目を削除
  return doc.toString()
    .replace(/\r|\n/gi, "")
    .replace(/ *</g,"<")
    .replace(/> */g,">")
    .replace(/ *\?>/g,"?>")
    .replace(/\t/i," ");
};

/**
 * 指定の範囲にGPXデータを丸め込む。
 * @param string gpx GPX文字列
 * @param Date start 開始時間
 * @param Date end 終了時間
 * @return string UTF8でGPX文字列を返す。改行は削除。失敗時はfalseを返す
 */
exports.trim = function (gpx, start, end) {
  var tm;
  var parent;
  var parser = new DOMParser();
  var doc = parser.parseFromString(gpx, "application/xml");
  var times = doc.getElementsByTagName('time');
  var isFirst = true;
  var lasttrk = 0;
  var clone;
  var noStart = false;
  var noEnd = false;

  // チェック
  if (!exports.validGPX(gpx)) {
    return false;
  }

  // 処理内容をリセット
  lastStatus = "";

  // データのチェック
  if (!(start instanceof Date)) {
    noStart = true;
  }
  if (!(end instanceof Date)) {
    noEnd = true;
  }

  // データがなかったら何もせずに返す
  if (times.length === 0) {
    return exports.removeSegment(doc.toString());
  }

  // データをトリミング
  for (var i=0 ; i<times.length ; i++) {
    if (times[i].parentNode.tagName !== "trkpt") continue;

    // 最初の1つめがstartより後ろだったら、最初にデータを追加する
    if (  isFirst &&
          !noStart &&
          (new Date(times[i].firstChild) > start)) {
      clone = getCloneTrkpt(times[i], doc.createTextNode(ISODateString(start)));
      times[i].parentNode.parentNode.insertBefore(clone, times[i].parentNode);
      isFirst = false;
      lastStatus += "Add Start Data:"+start+"\n";
      continue;
    }
    isFirst = false;

    // 最後のデータ
    lasttrk = i;

    // 時間より前か
    tm = new Date(times[i].firstChild);
    if (  ((tm < start) && !noStart) ||
          ((tm > end) && !noEnd)) {
      // このデータを削除
      times[i].parentNode.parentNode.removeChild(times[i].parentNode);
      i--;
      //
      lastStatus += "Remove Data:"+tm+"\n";
    }
  }

  // 最後の時間がendより前だったら追加
  if ((tm < end) && (!noEnd)) {
    clone = getCloneTrkpt(times[lasttrk], doc.createTextNode(ISODateString(end)));
    times[lasttrk].parentNode.parentNode.appendChild(clone, times[lasttrk].parentNode);
    lastStatus += "Add End Data:"+end+"\n";
  }

  return exports.removeSegment(doc.toString());
};

/**
 * 指定のtimeエレメントを含むtrkptエレメントを複製して、指定の時間に差し替える
 * @param element elemtm 複製するDOMElement
 * @param element time 差し替える時間をTextNodeに設定したエレメント
 * @return element クローンして時間を差し替えたDOMElement
 */
function getCloneTrkpt(elemtm, time) {
  var clone = elemtm.parentNode.cloneNode(true);
  var clonetime = clone.getElementsByTagName('time')[0];
  clonetime.removeChild(clonetime.firstChild);
  clonetime.appendChild(time);
  return clone;
}


/**
 * 指定の距離以内の点をまとめる。
 * @param string gpx GPX文字列
 * @param number dist 距離をメートル単位で指定。この距離以内の点をまとめる
 * @param bool leftLast true=最初と最後の点を残す / false=最初の点のみ残す。初期値はtrue
 * @param bool useEle true=高度データを利用 / false=標高を無視 / 初期値はtrue
 * @return string UTF8でGPX文字列を返す。改行は削除。失敗時はfalseを返す
 */
exports.group = function(gpx, dist, leftLast, useEle) {
  // チェック
  if (!exports.validGPX(gpx)) {
    return false;
  }

  return "<gpx></gpx>";
};

/**
 * 異常値の削除。指定の秒速よりも速い移動で1つだけはみ出す点があったら削除する
 * @param string gpx GPX文字列
 * @param number vel 異常値を秒速で指定
 * @return string UTF8でGPX文字列を返す。改行は削除。失敗時はfalseを返す
 */
exports.cut = function(gpx, vel) {
  // チェック
  if (!exports.validGPX(gpx)) {
    return false;
  }

  return "<gpx></gpx>";
};

/**
 * 時間を取得して、オブジェクトで返す
 * @param string gpx GPXのUTF8文字列
 * @return first=開始時間 / last=終了時間のDateオブジェクト。失敗時はfalseを返す
 */
exports.getTime = function(gpx) {
  var parser = new DOMParser();
  var doc = parser.parseFromString(gpx, "application/xml");
  var times = doc.getElementsByTagName('time');
  var ret = {};

  // チェック
  if (!exports.validGPX(gpx)) {
    return false;
  }

  for (var i=0 ; i<times.length ; i++) {
    if (times[i].parentNode.tagName !== "trkpt") {
      continue;
    }
    // 最初のデータ
    if (!ret.hasOwnProperty('first')) {
      ret.first = new Date(times[i].firstChild);
    }
    else {
      ret.last = new Date(times[i].firstChild);
    }
  }
  return ret;
};

/* 望まれる正確な形式のために関数を使用します...
https://developer.mozilla.org/ja/docs/Web/JavaScript/Reference/Global_Objects/Date
*/
function ISODateString(d){
  function pad(n){return n<10 ? '0'+n : n;}
  return d.getUTCFullYear()+'-' +
    pad(d.getUTCMonth()+1)+'-' +
    pad(d.getUTCDate())+'T' +
    pad(d.getUTCHours())+':' +
    pad(d.getUTCMinutes())+':' +
    pad(d.getUTCSeconds())+'Z';
}

}).call(this,require("VCmEsw"),typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer,arguments[3],arguments[4],arguments[5],arguments[6],"/gpx-trimmer.js","/")
},{"VCmEsw":4,"buffer":1,"xmldom":5}]},{},[8])
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIkM6XFxVc2Vyc1xcWXVUYW5rYVxcRG9jdW1lbnRzXFxHaXRIdWJcXGdweC10cmltbWVyLWpzXFxub2RlX21vZHVsZXNcXGd1bHAtYnJvd3NlcmlmeVxcbm9kZV9tb2R1bGVzXFxicm93c2VyaWZ5XFxub2RlX21vZHVsZXNcXGJyb3dzZXItcGFja1xcX3ByZWx1ZGUuanMiLCJDOi9Vc2Vycy9ZdVRhbmthL0RvY3VtZW50cy9HaXRIdWIvZ3B4LXRyaW1tZXItanMvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL2luZGV4LmpzIiwiQzovVXNlcnMvWXVUYW5rYS9Eb2N1bWVudHMvR2l0SHViL2dweC10cmltbWVyLWpzL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2J1ZmZlci9ub2RlX21vZHVsZXMvYmFzZTY0LWpzL2xpYi9iNjQuanMiLCJDOi9Vc2Vycy9ZdVRhbmthL0RvY3VtZW50cy9HaXRIdWIvZ3B4LXRyaW1tZXItanMvbm9kZV9tb2R1bGVzL2d1bHAtYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwiQzovVXNlcnMvWXVUYW5rYS9Eb2N1bWVudHMvR2l0SHViL2dweC10cmltbWVyLWpzL25vZGVfbW9kdWxlcy9ndWxwLWJyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qcyIsIkM6L1VzZXJzL1l1VGFua2EvRG9jdW1lbnRzL0dpdEh1Yi9ncHgtdHJpbW1lci1qcy9ub2RlX21vZHVsZXMveG1sZG9tL2RvbS1wYXJzZXIuanMiLCJDOi9Vc2Vycy9ZdVRhbmthL0RvY3VtZW50cy9HaXRIdWIvZ3B4LXRyaW1tZXItanMvbm9kZV9tb2R1bGVzL3htbGRvbS9kb20uanMiLCJDOi9Vc2Vycy9ZdVRhbmthL0RvY3VtZW50cy9HaXRIdWIvZ3B4LXRyaW1tZXItanMvbm9kZV9tb2R1bGVzL3htbGRvbS9zYXguanMiLCJDOi9Vc2Vycy9ZdVRhbmthL0RvY3VtZW50cy9HaXRIdWIvZ3B4LXRyaW1tZXItanMvc3JjL2Zha2VfY2E0YTZhNjIuanMiLCJDOi9Vc2Vycy9ZdVRhbmthL0RvY3VtZW50cy9HaXRIdWIvZ3B4LXRyaW1tZXItanMvc3JjL2dweC10cmltbWVyLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBO0FDQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2bENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzlIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdEZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqRUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pRQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMWtCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQy9IQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3Rocm93IG5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIil9dmFyIGY9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGYuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sZixmLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTJcblxuLyoqXG4gKiBJZiBgQnVmZmVyLl91c2VUeXBlZEFycmF5c2A6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChjb21wYXRpYmxlIGRvd24gdG8gSUU2KVxuICovXG5CdWZmZXIuX3VzZVR5cGVkQXJyYXlzID0gKGZ1bmN0aW9uICgpIHtcbiAgLy8gRGV0ZWN0IGlmIGJyb3dzZXIgc3VwcG9ydHMgVHlwZWQgQXJyYXlzLiBTdXBwb3J0ZWQgYnJvd3NlcnMgYXJlIElFIDEwKywgRmlyZWZveCA0KyxcbiAgLy8gQ2hyb21lIDcrLCBTYWZhcmkgNS4xKywgT3BlcmEgMTEuNissIGlPUyA0LjIrLiBJZiB0aGUgYnJvd3NlciBkb2VzIG5vdCBzdXBwb3J0IGFkZGluZ1xuICAvLyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMsIHRoZW4gdGhhdCdzIHRoZSBzYW1lIGFzIG5vIGBVaW50OEFycmF5YCBzdXBwb3J0XG4gIC8vIGJlY2F1c2Ugd2UgbmVlZCB0byBiZSBhYmxlIHRvIGFkZCBhbGwgdGhlIG5vZGUgQnVmZmVyIEFQSSBtZXRob2RzLiBUaGlzIGlzIGFuIGlzc3VlXG4gIC8vIGluIEZpcmVmb3ggNC0yOS4gTm93IGZpeGVkOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzhcbiAgdHJ5IHtcbiAgICB2YXIgYnVmID0gbmV3IEFycmF5QnVmZmVyKDApXG4gICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KGJ1ZilcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIHJldHVybiA0MiA9PT0gYXJyLmZvbygpICYmXG4gICAgICAgIHR5cGVvZiBhcnIuc3ViYXJyYXkgPT09ICdmdW5jdGlvbicgLy8gQ2hyb21lIDktMTAgbGFjayBgc3ViYXJyYXlgXG4gIH0gY2F0Y2ggKGUpIHtcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxufSkoKVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChzdWJqZWN0LCBlbmNvZGluZywgbm9aZXJvKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nLCBub1plcm8pXG5cbiAgdmFyIHR5cGUgPSB0eXBlb2Ygc3ViamVjdFxuXG4gIC8vIFdvcmthcm91bmQ6IG5vZGUncyBiYXNlNjQgaW1wbGVtZW50YXRpb24gYWxsb3dzIGZvciBub24tcGFkZGVkIHN0cmluZ3NcbiAgLy8gd2hpbGUgYmFzZTY0LWpzIGRvZXMgbm90LlxuICBpZiAoZW5jb2RpbmcgPT09ICdiYXNlNjQnICYmIHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgc3ViamVjdCA9IHN0cmluZ3RyaW0oc3ViamVjdClcbiAgICB3aGlsZSAoc3ViamVjdC5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgICBzdWJqZWN0ID0gc3ViamVjdCArICc9J1xuICAgIH1cbiAgfVxuXG4gIC8vIEZpbmQgdGhlIGxlbmd0aFxuICB2YXIgbGVuZ3RoXG4gIGlmICh0eXBlID09PSAnbnVtYmVyJylcbiAgICBsZW5ndGggPSBjb2VyY2Uoc3ViamVjdClcbiAgZWxzZSBpZiAodHlwZSA9PT0gJ3N0cmluZycpXG4gICAgbGVuZ3RoID0gQnVmZmVyLmJ5dGVMZW5ndGgoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGVsc2UgaWYgKHR5cGUgPT09ICdvYmplY3QnKVxuICAgIGxlbmd0aCA9IGNvZXJjZShzdWJqZWN0Lmxlbmd0aCkgLy8gYXNzdW1lIHRoYXQgb2JqZWN0IGlzIGFycmF5LWxpa2VcbiAgZWxzZVxuICAgIHRocm93IG5ldyBFcnJvcignRmlyc3QgYXJndW1lbnQgbmVlZHMgdG8gYmUgYSBudW1iZXIsIGFycmF5IG9yIHN0cmluZy4nKVxuXG4gIHZhciBidWZcbiAgaWYgKEJ1ZmZlci5fdXNlVHlwZWRBcnJheXMpIHtcbiAgICAvLyBQcmVmZXJyZWQ6IFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYnVmID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBUSElTIGluc3RhbmNlIG9mIEJ1ZmZlciAoY3JlYXRlZCBieSBgbmV3YClcbiAgICBidWYgPSB0aGlzXG4gICAgYnVmLmxlbmd0aCA9IGxlbmd0aFxuICAgIGJ1Zi5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgaVxuICBpZiAoQnVmZmVyLl91c2VUeXBlZEFycmF5cyAmJiB0eXBlb2Ygc3ViamVjdC5ieXRlTGVuZ3RoID09PSAnbnVtYmVyJykge1xuICAgIC8vIFNwZWVkIG9wdGltaXphdGlvbiAtLSB1c2Ugc2V0IGlmIHdlJ3JlIGNvcHlpbmcgZnJvbSBhIHR5cGVkIGFycmF5XG4gICAgYnVmLl9zZXQoc3ViamVjdClcbiAgfSBlbHNlIGlmIChpc0FycmF5aXNoKHN1YmplY3QpKSB7XG4gICAgLy8gVHJlYXQgYXJyYXktaXNoIG9iamVjdHMgYXMgYSBieXRlIGFycmF5XG4gICAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpKVxuICAgICAgICBidWZbaV0gPSBzdWJqZWN0LnJlYWRVSW50OChpKVxuICAgICAgZWxzZVxuICAgICAgICBidWZbaV0gPSBzdWJqZWN0W2ldXG4gICAgfVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdzdHJpbmcnKSB7XG4gICAgYnVmLndyaXRlKHN1YmplY3QsIDAsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKHR5cGUgPT09ICdudW1iZXInICYmICFCdWZmZXIuX3VzZVR5cGVkQXJyYXlzICYmICFub1plcm8pIHtcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIGJ1ZltpXSA9IDBcbiAgICB9XG4gIH1cblxuICByZXR1cm4gYnVmXG59XG5cbi8vIFNUQVRJQyBNRVRIT0RTXG4vLyA9PT09PT09PT09PT09PVxuXG5CdWZmZXIuaXNFbmNvZGluZyA9IGZ1bmN0aW9uIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gKGIpIHtcbiAgcmV0dXJuICEhKGIgIT09IG51bGwgJiYgYiAhPT0gdW5kZWZpbmVkICYmIGIuX2lzQnVmZmVyKVxufVxuXG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGZ1bmN0aW9uIChzdHIsIGVuY29kaW5nKSB7XG4gIHZhciByZXRcbiAgc3RyID0gc3RyICsgJydcbiAgc3dpdGNoIChlbmNvZGluZyB8fCAndXRmOCcpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgICAgcmV0ID0gc3RyLmxlbmd0aCAvIDJcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgICAgcmV0ID0gdXRmOFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYXNjaWknOlxuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgY2FzZSAncmF3JzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IGJhc2U2NFRvQnl0ZXMoc3RyKS5sZW5ndGhcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldCA9IHN0ci5sZW5ndGggKiAyXG4gICAgICBicmVha1xuICAgIGRlZmF1bHQ6XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ1Vua25vd24gZW5jb2RpbmcnKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIChsaXN0LCB0b3RhbExlbmd0aCkge1xuICBhc3NlcnQoaXNBcnJheShsaXN0KSwgJ1VzYWdlOiBCdWZmZXIuY29uY2F0KGxpc3QsIFt0b3RhbExlbmd0aF0pXFxuJyArXG4gICAgICAnbGlzdCBzaG91bGQgYmUgYW4gQXJyYXkuJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9IGVsc2UgaWYgKGxpc3QubGVuZ3RoID09PSAxKSB7XG4gICAgcmV0dXJuIGxpc3RbMF1cbiAgfVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdG90YWxMZW5ndGggIT09ICdudW1iZXInKSB7XG4gICAgdG90YWxMZW5ndGggPSAwXG4gICAgZm9yIChpID0gMDsgaSA8IGxpc3QubGVuZ3RoOyBpKyspIHtcbiAgICAgIHRvdGFsTGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIodG90YWxMZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuLy8gQlVGRkVSIElOU1RBTkNFIE1FVEhPRFNcbi8vID09PT09PT09PT09PT09PT09PT09PT09XG5cbmZ1bmN0aW9uIF9oZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGFzc2VydChzdHJMZW4gJSAyID09PSAwLCAnSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGJ5dGUgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgYXNzZXJ0KCFpc05hTihieXRlKSwgJ0ludmFsaWQgaGV4IHN0cmluZycpXG4gICAgYnVmW29mZnNldCArIGldID0gYnl0ZVxuICB9XG4gIEJ1ZmZlci5fY2hhcnNXcml0dGVuID0gaSAqIDJcbiAgcmV0dXJuIGlcbn1cblxuZnVuY3Rpb24gX3V0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIF9hc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIGNoYXJzV3JpdHRlbiA9IEJ1ZmZlci5fY2hhcnNXcml0dGVuID1cbiAgICBibGl0QnVmZmVyKGFzY2lpVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbmZ1bmN0aW9uIF9iaW5hcnlXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBfYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIF9iYXNlNjRXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcihiYXNlNjRUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG4gIHJldHVybiBjaGFyc1dyaXR0ZW5cbn1cblxuZnVuY3Rpb24gX3V0ZjE2bGVXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHZhciBjaGFyc1dyaXR0ZW4gPSBCdWZmZXIuX2NoYXJzV3JpdHRlbiA9XG4gICAgYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxuICByZXR1cm4gY2hhcnNXcml0dGVuXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGUgPSBmdW5jdGlvbiAoc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCwgZW5jb2RpbmcpIHtcbiAgLy8gU3VwcG9ydCBib3RoIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZylcbiAgLy8gYW5kIHRoZSBsZWdhY3kgKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICBpZiAoaXNGaW5pdGUob2Zmc2V0KSkge1xuICAgIGlmICghaXNGaW5pdGUobGVuZ3RoKSkge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgfSBlbHNlIHsgIC8vIGxlZ2FjeVxuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aFxuICAgIGxlbmd0aCA9IHN3YXBcbiAgfVxuXG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmICghbGVuZ3RoKSB7XG4gICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gIH0gZWxzZSB7XG4gICAgbGVuZ3RoID0gTnVtYmVyKGxlbmd0aClcbiAgICBpZiAobGVuZ3RoID4gcmVtYWluaW5nKSB7XG4gICAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgICB9XG4gIH1cbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpXG5cbiAgdmFyIHJldFxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IF9oZXhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSBfdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IF9hc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSBfYmluYXJ5V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IF9iYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gX3V0ZjE2bGVXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG5cbiAgZW5jb2RpbmcgPSBTdHJpbmcoZW5jb2RpbmcgfHwgJ3V0ZjgnKS50b0xvd2VyQ2FzZSgpXG4gIHN0YXJ0ID0gTnVtYmVyKHN0YXJ0KSB8fCAwXG4gIGVuZCA9IChlbmQgIT09IHVuZGVmaW5lZClcbiAgICA/IE51bWJlcihlbmQpXG4gICAgOiBlbmQgPSBzZWxmLmxlbmd0aFxuXG4gIC8vIEZhc3RwYXRoIGVtcHR5IHN0cmluZ3NcbiAgaWYgKGVuZCA9PT0gc3RhcnQpXG4gICAgcmV0dXJuICcnXG5cbiAgdmFyIHJldFxuICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgY2FzZSAnaGV4JzpcbiAgICAgIHJldCA9IF9oZXhTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1dGY4JzpcbiAgICBjYXNlICd1dGYtOCc6XG4gICAgICByZXQgPSBfdXRmOFNsaWNlKHNlbGYsIHN0YXJ0LCBlbmQpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIHJldCA9IF9hc2NpaVNsaWNlKHNlbGYsIHN0YXJ0LCBlbmQpXG4gICAgICBicmVha1xuICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICByZXQgPSBfYmluYXJ5U2xpY2Uoc2VsZiwgc3RhcnQsIGVuZClcbiAgICAgIGJyZWFrXG4gICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgIHJldCA9IF9iYXNlNjRTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0ID0gX3V0ZjE2bGVTbGljZShzZWxmLCBzdGFydCwgZW5kKVxuICAgICAgYnJlYWtcbiAgICBkZWZhdWx0OlxuICAgICAgdGhyb3cgbmV3IEVycm9yKCdVbmtub3duIGVuY29kaW5nJylcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9KU09OID0gZnVuY3Rpb24gKCkge1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdCdWZmZXInLFxuICAgIGRhdGE6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHRoaXMuX2FyciB8fCB0aGlzLCAwKVxuICB9XG59XG5cbi8vIGNvcHkodGFyZ2V0QnVmZmVyLCB0YXJnZXRTdGFydD0wLCBzb3VyY2VTdGFydD0wLCBzb3VyY2VFbmQ9YnVmZmVyLmxlbmd0aClcbkJ1ZmZlci5wcm90b3R5cGUuY29weSA9IGZ1bmN0aW9uICh0YXJnZXQsIHRhcmdldF9zdGFydCwgc3RhcnQsIGVuZCkge1xuICB2YXIgc291cmNlID0gdGhpc1xuXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICghdGFyZ2V0X3N0YXJ0KSB0YXJnZXRfc3RhcnQgPSAwXG5cbiAgLy8gQ29weSAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgc291cmNlLmxlbmd0aCA9PT0gMCkgcmV0dXJuXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBhc3NlcnQoZW5kID49IHN0YXJ0LCAnc291cmNlRW5kIDwgc291cmNlU3RhcnQnKVxuICBhc3NlcnQodGFyZ2V0X3N0YXJ0ID49IDAgJiYgdGFyZ2V0X3N0YXJ0IDwgdGFyZ2V0Lmxlbmd0aCxcbiAgICAgICd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgYXNzZXJ0KHN0YXJ0ID49IDAgJiYgc3RhcnQgPCBzb3VyY2UubGVuZ3RoLCAnc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGFzc2VydChlbmQgPj0gMCAmJiBlbmQgPD0gc291cmNlLmxlbmd0aCwgJ3NvdXJjZUVuZCBvdXQgb2YgYm91bmRzJylcblxuICAvLyBBcmUgd2Ugb29iP1xuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpXG4gICAgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRfc3RhcnQgPCBlbmQgLSBzdGFydClcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0X3N0YXJ0ICsgc3RhcnRcblxuICB2YXIgbGVuID0gZW5kIC0gc3RhcnRcblxuICBpZiAobGVuIDwgMTAwIHx8ICFCdWZmZXIuX3VzZVR5cGVkQXJyYXlzKSB7XG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0X3N0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0X3N0YXJ0KVxuICB9XG59XG5cbmZ1bmN0aW9uIF9iYXNlNjRTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGlmIChzdGFydCA9PT0gMCAmJiBlbmQgPT09IGJ1Zi5sZW5ndGgpIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmKVxuICB9IGVsc2Uge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYuc2xpY2Uoc3RhcnQsIGVuZCkpXG4gIH1cbn1cblxuZnVuY3Rpb24gX3V0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXMgPSAnJ1xuICB2YXIgdG1wID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgaWYgKGJ1ZltpXSA8PSAweDdGKSB7XG4gICAgICByZXMgKz0gZGVjb2RlVXRmOENoYXIodG1wKSArIFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICAgICAgdG1wID0gJydcbiAgICB9IGVsc2Uge1xuICAgICAgdG1wICs9ICclJyArIGJ1ZltpXS50b1N0cmluZygxNilcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzICsgZGVjb2RlVXRmOENoYXIodG1wKVxufVxuXG5mdW5jdGlvbiBfYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspXG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIF9iaW5hcnlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHJldHVybiBfYXNjaWlTbGljZShidWYsIHN0YXJ0LCBlbmQpXG59XG5cbmZ1bmN0aW9uIF9oZXhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG5cbiAgaWYgKCFzdGFydCB8fCBzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCB8fCBlbmQgPCAwIHx8IGVuZCA+IGxlbikgZW5kID0gbGVuXG5cbiAgdmFyIG91dCA9ICcnXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgb3V0ICs9IHRvSGV4KGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gb3V0XG59XG5cbmZ1bmN0aW9uIF91dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIGJ5dGVzW2krMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gY2xhbXAoc3RhcnQsIGxlbiwgMClcbiAgZW5kID0gY2xhbXAoZW5kLCBsZW4sIGxlbilcblxuICBpZiAoQnVmZmVyLl91c2VUeXBlZEFycmF5cykge1xuICAgIHJldHVybiBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIHZhciBuZXdCdWYgPSBuZXcgQnVmZmVyKHNsaWNlTGVuLCB1bmRlZmluZWQsIHRydWUpXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzbGljZUxlbjsgaSsrKSB7XG4gICAgICBuZXdCdWZbaV0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gICAgcmV0dXJuIG5ld0J1ZlxuICB9XG59XG5cbi8vIGBnZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLmdldCA9IGZ1bmN0aW9uIChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIHdpbGwgYmUgcmVtb3ZlZCBpbiBOb2RlIDAuMTMrXG5CdWZmZXIucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgPCB0aGlzLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpXG4gICAgcmV0dXJuXG5cbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5mdW5jdGlvbiBfcmVhZFVJbnQxNiAoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAxIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIHZhciB2YWxcbiAgaWYgKGxpdHRsZUVuZGlhbikge1xuICAgIHZhbCA9IGJ1ZltvZmZzZXRdXG4gICAgaWYgKG9mZnNldCArIDEgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDFdIDw8IDhcbiAgfSBlbHNlIHtcbiAgICB2YWwgPSBidWZbb2Zmc2V0XSA8PCA4XG4gICAgaWYgKG9mZnNldCArIDEgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDFdXG4gIH1cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQxNih0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQxNih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3JlYWRVSW50MzIgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICB2YXIgdmFsXG4gIGlmIChsaXR0bGVFbmRpYW4pIHtcbiAgICBpZiAob2Zmc2V0ICsgMiA8IGxlbilcbiAgICAgIHZhbCA9IGJ1ZltvZmZzZXQgKyAyXSA8PCAxNlxuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsIHw9IGJ1ZltvZmZzZXQgKyAxXSA8PCA4XG4gICAgdmFsIHw9IGJ1ZltvZmZzZXRdXG4gICAgaWYgKG9mZnNldCArIDMgPCBsZW4pXG4gICAgICB2YWwgPSB2YWwgKyAoYnVmW29mZnNldCArIDNdIDw8IDI0ID4+PiAwKVxuICB9IGVsc2Uge1xuICAgIGlmIChvZmZzZXQgKyAxIDwgbGVuKVxuICAgICAgdmFsID0gYnVmW29mZnNldCArIDFdIDw8IDE2XG4gICAgaWYgKG9mZnNldCArIDIgPCBsZW4pXG4gICAgICB2YWwgfD0gYnVmW29mZnNldCArIDJdIDw8IDhcbiAgICBpZiAob2Zmc2V0ICsgMyA8IGxlbilcbiAgICAgIHZhbCB8PSBidWZbb2Zmc2V0ICsgM11cbiAgICB2YWwgPSB2YWwgKyAoYnVmW29mZnNldF0gPDwgMjQgPj4+IDApXG4gIH1cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJMRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQzMih0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZFVJbnQzMih0aGlzLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLFxuICAgICAgICAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgPCB0aGlzLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpXG4gICAgcmV0dXJuXG5cbiAgdmFyIG5lZyA9IHRoaXNbb2Zmc2V0XSAmIDB4ODBcbiAgaWYgKG5lZylcbiAgICByZXR1cm4gKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xXG4gIGVsc2VcbiAgICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbmZ1bmN0aW9uIF9yZWFkSW50MTYgKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMSA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gcmVhZCBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICB2YXIgdmFsID0gX3JlYWRVSW50MTYoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgdHJ1ZSlcbiAgdmFyIG5lZyA9IHZhbCAmIDB4ODAwMFxuICBpZiAobmVnKVxuICAgIHJldHVybiAoMHhmZmZmIC0gdmFsICsgMSkgKiAtMVxuICBlbHNlXG4gICAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkSW50MTYodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDE2KHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfcmVhZEludDMyIChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDMgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHJlYWQgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgdmFyIHZhbCA9IF9yZWFkVUludDMyKGJ1Ziwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIHRydWUpXG4gIHZhciBuZWcgPSB2YWwgJiAweDgwMDAwMDAwXG4gIGlmIChuZWcpXG4gICAgcmV0dXJuICgweGZmZmZmZmZmIC0gdmFsICsgMSkgKiAtMVxuICBlbHNlXG4gICAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQzMkxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkSW50MzIodGhpcywgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiBfcmVhZEludDMyKHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfcmVhZEZsb2F0IChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHJldHVybiBpZWVlNzU0LnJlYWQoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiAob2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gX3JlYWRGbG9hdCh0aGlzLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRGbG9hdEJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRmxvYXQodGhpcywgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF9yZWFkRG91YmxlIChidWYsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgKyA3IDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byByZWFkIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgfVxuXG4gIHJldHVybiBpZWVlNzU0LnJlYWQoYnVmLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRG91YmxlKHRoaXMsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIF9yZWFkRG91YmxlKHRoaXMsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0IDwgdGhpcy5sZW5ndGgsICd0cnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmdWludCh2YWx1ZSwgMHhmZilcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVyblxuXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG59XG5cbmZ1bmN0aW9uIF93cml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAxIDwgYnVmLmxlbmd0aCwgJ3RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZ1aW50KHZhbHVlLCAweGZmZmYpXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGxlbiAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPVxuICAgICAgICAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ3RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZ1aW50KHZhbHVlLCAweGZmZmZmZmZmKVxuICB9XG5cbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcbiAgaWYgKG9mZnNldCA+PSBsZW4pXG4gICAgcmV0dXJuXG5cbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihsZW4gLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID1cbiAgICAgICAgKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJCRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgPCB0aGlzLmxlbmd0aCwgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZzaW50KHZhbHVlLCAweDdmLCAtMHg4MClcbiAgfVxuXG4gIGlmIChvZmZzZXQgPj0gdGhpcy5sZW5ndGgpXG4gICAgcmV0dXJuXG5cbiAgaWYgKHZhbHVlID49IDApXG4gICAgdGhpcy53cml0ZVVJbnQ4KHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KVxuICBlbHNlXG4gICAgdGhpcy53cml0ZVVJbnQ4KDB4ZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIF93cml0ZUludDE2IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGFzc2VydCh2YWx1ZSAhPT0gdW5kZWZpbmVkICYmIHZhbHVlICE9PSBudWxsLCAnbWlzc2luZyB2YWx1ZScpXG4gICAgYXNzZXJ0KHR5cGVvZiBsaXR0bGVFbmRpYW4gPT09ICdib29sZWFuJywgJ21pc3Npbmcgb3IgaW52YWxpZCBlbmRpYW4nKVxuICAgIGFzc2VydChvZmZzZXQgIT09IHVuZGVmaW5lZCAmJiBvZmZzZXQgIT09IG51bGwsICdtaXNzaW5nIG9mZnNldCcpXG4gICAgYXNzZXJ0KG9mZnNldCArIDEgPCBidWYubGVuZ3RoLCAnVHJ5aW5nIHRvIHdyaXRlIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbiAgICB2ZXJpZnNpbnQodmFsdWUsIDB4N2ZmZiwgLTB4ODAwMClcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGlmICh2YWx1ZSA+PSAwKVxuICAgIF93cml0ZVVJbnQxNihidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpXG4gIGVsc2VcbiAgICBfd3JpdGVVSW50MTYoYnVmLCAweGZmZmYgKyB2YWx1ZSArIDEsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24gKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIF93cml0ZUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gX3dyaXRlSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgMyA8IGJ1Zi5sZW5ndGgsICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmc2ludCh2YWx1ZSwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIH1cblxuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuICBpZiAob2Zmc2V0ID49IGxlbilcbiAgICByZXR1cm5cblxuICBpZiAodmFsdWUgPj0gMClcbiAgICBfd3JpdGVVSW50MzIoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KVxuICBlbHNlXG4gICAgX3dyaXRlVUludDMyKGJ1ZiwgMHhmZmZmZmZmZiArIHZhbHVlICsgMSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVGbG9hdCAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICBhc3NlcnQodmFsdWUgIT09IHVuZGVmaW5lZCAmJiB2YWx1ZSAhPT0gbnVsbCwgJ21pc3NpbmcgdmFsdWUnKVxuICAgIGFzc2VydCh0eXBlb2YgbGl0dGxlRW5kaWFuID09PSAnYm9vbGVhbicsICdtaXNzaW5nIG9yIGludmFsaWQgZW5kaWFuJylcbiAgICBhc3NlcnQob2Zmc2V0ICE9PSB1bmRlZmluZWQgJiYgb2Zmc2V0ICE9PSBudWxsLCAnbWlzc2luZyBvZmZzZXQnKVxuICAgIGFzc2VydChvZmZzZXQgKyAzIDwgYnVmLmxlbmd0aCwgJ1RyeWluZyB0byB3cml0ZSBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG4gICAgdmVyaWZJRUVFNzU0KHZhbHVlLCAzLjQwMjgyMzQ2NjM4NTI4ODZlKzM4LCAtMy40MDI4MjM0NjYzODUyODg2ZSszOClcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICBfd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG5mdW5jdGlvbiBfd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgYXNzZXJ0KHZhbHVlICE9PSB1bmRlZmluZWQgJiYgdmFsdWUgIT09IG51bGwsICdtaXNzaW5nIHZhbHVlJylcbiAgICBhc3NlcnQodHlwZW9mIGxpdHRsZUVuZGlhbiA9PT0gJ2Jvb2xlYW4nLCAnbWlzc2luZyBvciBpbnZhbGlkIGVuZGlhbicpXG4gICAgYXNzZXJ0KG9mZnNldCAhPT0gdW5kZWZpbmVkICYmIG9mZnNldCAhPT0gbnVsbCwgJ21pc3Npbmcgb2Zmc2V0JylcbiAgICBhc3NlcnQob2Zmc2V0ICsgNyA8IGJ1Zi5sZW5ndGgsXG4gICAgICAgICdUcnlpbmcgdG8gd3JpdGUgYmV5b25kIGJ1ZmZlciBsZW5ndGgnKVxuICAgIHZlcmlmSUVFRTc1NCh2YWx1ZSwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuXG4gIHZhciBsZW4gPSBidWYubGVuZ3RoXG4gIGlmIChvZmZzZXQgPj0gbGVuKVxuICAgIHJldHVyblxuXG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDUyLCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlTEUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgX3dyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gZmlsbCh2YWx1ZSwgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykge1xuICAgIHZhbHVlID0gdmFsdWUuY2hhckNvZGVBdCgwKVxuICB9XG5cbiAgYXNzZXJ0KHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgJiYgIWlzTmFOKHZhbHVlKSwgJ3ZhbHVlIGlzIG5vdCBhIG51bWJlcicpXG4gIGFzc2VydChlbmQgPj0gc3RhcnQsICdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBhc3NlcnQoc3RhcnQgPj0gMCAmJiBzdGFydCA8IHRoaXMubGVuZ3RoLCAnc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGFzc2VydChlbmQgPj0gMCAmJiBlbmQgPD0gdGhpcy5sZW5ndGgsICdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICB0aGlzW2ldID0gdmFsdWVcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBvdXQgPSBbXVxuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIG91dFtpXSA9IHRvSGV4KHRoaXNbaV0pXG4gICAgaWYgKGkgPT09IGV4cG9ydHMuSU5TUEVDVF9NQVhfQllURVMpIHtcbiAgICAgIG91dFtpICsgMV0gPSAnLi4uJ1xuICAgICAgYnJlYWtcbiAgICB9XG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBvdXQuam9pbignICcpICsgJz4nXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKHR5cGVvZiBVaW50OEFycmF5ICE9PSAndW5kZWZpbmVkJykge1xuICAgIGlmIChCdWZmZXIuX3VzZVR5cGVkQXJyYXlzKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKVxuICAgICAgICBidWZbaV0gPSB0aGlzW2ldXG4gICAgICByZXR1cm4gYnVmLmJ1ZmZlclxuICAgIH1cbiAgfSBlbHNlIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbmZ1bmN0aW9uIHN0cmluZ3RyaW0gKHN0cikge1xuICBpZiAoc3RyLnRyaW0pIHJldHVybiBzdHIudHJpbSgpXG4gIHJldHVybiBzdHIucmVwbGFjZSgvXlxccyt8XFxzKyQvZywgJycpXG59XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIChhcnIpIHtcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IGdldC9zZXQgbWV0aG9kcyBiZWZvcmUgb3ZlcndyaXRpbmdcbiAgYXJyLl9nZXQgPSBhcnIuZ2V0XG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWQsIHdpbGwgYmUgcmVtb3ZlZCBpbiBub2RlIDAuMTMrXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbi8vIHNsaWNlKHN0YXJ0LCBlbmQpXG5mdW5jdGlvbiBjbGFtcCAoaW5kZXgsIGxlbiwgZGVmYXVsdFZhbHVlKSB7XG4gIGlmICh0eXBlb2YgaW5kZXggIT09ICdudW1iZXInKSByZXR1cm4gZGVmYXVsdFZhbHVlXG4gIGluZGV4ID0gfn5pbmRleDsgIC8vIENvZXJjZSB0byBpbnRlZ2VyLlxuICBpZiAoaW5kZXggPj0gbGVuKSByZXR1cm4gbGVuXG4gIGlmIChpbmRleCA+PSAwKSByZXR1cm4gaW5kZXhcbiAgaW5kZXggKz0gbGVuXG4gIGlmIChpbmRleCA+PSAwKSByZXR1cm4gaW5kZXhcbiAgcmV0dXJuIDBcbn1cblxuZnVuY3Rpb24gY29lcmNlIChsZW5ndGgpIHtcbiAgLy8gQ29lcmNlIGxlbmd0aCB0byBhIG51bWJlciAocG9zc2libHkgTmFOKSwgcm91bmQgdXBcbiAgLy8gaW4gY2FzZSBpdCdzIGZyYWN0aW9uYWwgKGUuZy4gMTIzLjQ1NikgdGhlbiBkbyBhXG4gIC8vIGRvdWJsZSBuZWdhdGUgdG8gY29lcmNlIGEgTmFOIHRvIDAuIEVhc3ksIHJpZ2h0P1xuICBsZW5ndGggPSB+fk1hdGguY2VpbCgrbGVuZ3RoKVxuICByZXR1cm4gbGVuZ3RoIDwgMCA/IDAgOiBsZW5ndGhcbn1cblxuZnVuY3Rpb24gaXNBcnJheSAoc3ViamVjdCkge1xuICByZXR1cm4gKEFycmF5LmlzQXJyYXkgfHwgZnVuY3Rpb24gKHN1YmplY3QpIHtcbiAgICByZXR1cm4gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKHN1YmplY3QpID09PSAnW29iamVjdCBBcnJheV0nXG4gIH0pKHN1YmplY3QpXG59XG5cbmZ1bmN0aW9uIGlzQXJyYXlpc2ggKHN1YmplY3QpIHtcbiAgcmV0dXJuIGlzQXJyYXkoc3ViamVjdCkgfHwgQnVmZmVyLmlzQnVmZmVyKHN1YmplY3QpIHx8XG4gICAgICBzdWJqZWN0ICYmIHR5cGVvZiBzdWJqZWN0ID09PSAnb2JqZWN0JyAmJlxuICAgICAgdHlwZW9mIHN1YmplY3QubGVuZ3RoID09PSAnbnVtYmVyJ1xufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHIpIHtcbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGIgPSBzdHIuY2hhckNvZGVBdChpKVxuICAgIGlmIChiIDw9IDB4N0YpXG4gICAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSlcbiAgICBlbHNlIHtcbiAgICAgIHZhciBzdGFydCA9IGlcbiAgICAgIGlmIChiID49IDB4RDgwMCAmJiBiIDw9IDB4REZGRikgaSsrXG4gICAgICB2YXIgaCA9IGVuY29kZVVSSUNvbXBvbmVudChzdHIuc2xpY2Uoc3RhcnQsIGkrMSkpLnN1YnN0cigxKS5zcGxpdCgnJScpXG4gICAgICBmb3IgKHZhciBqID0gMDsgaiA8IGgubGVuZ3RoOyBqKyspXG4gICAgICAgIGJ5dGVBcnJheS5wdXNoKHBhcnNlSW50KGhbal0sIDE2KSlcbiAgICB9XG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoc3RyKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgdmFyIHBvc1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKChpICsgb2Zmc2V0ID49IGRzdC5sZW5ndGgpIHx8IChpID49IHNyYy5sZW5ndGgpKVxuICAgICAgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiBkZWNvZGVVdGY4Q2hhciAoc3RyKSB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudChzdHIpXG4gIH0gY2F0Y2ggKGVycikge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKDB4RkZGRCkgLy8gVVRGIDggaW52YWxpZCBjaGFyXG4gIH1cbn1cblxuLypcbiAqIFdlIGhhdmUgdG8gbWFrZSBzdXJlIHRoYXQgdGhlIHZhbHVlIGlzIGEgdmFsaWQgaW50ZWdlci4gVGhpcyBtZWFucyB0aGF0IGl0XG4gKiBpcyBub24tbmVnYXRpdmUuIEl0IGhhcyBubyBmcmFjdGlvbmFsIGNvbXBvbmVudCBhbmQgdGhhdCBpdCBkb2VzIG5vdFxuICogZXhjZWVkIHRoZSBtYXhpbXVtIGFsbG93ZWQgdmFsdWUuXG4gKi9cbmZ1bmN0aW9uIHZlcmlmdWludCAodmFsdWUsIG1heCkge1xuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJywgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKVxuICBhc3NlcnQodmFsdWUgPj0gMCwgJ3NwZWNpZmllZCBhIG5lZ2F0aXZlIHZhbHVlIGZvciB3cml0aW5nIGFuIHVuc2lnbmVkIHZhbHVlJylcbiAgYXNzZXJ0KHZhbHVlIDw9IG1heCwgJ3ZhbHVlIGlzIGxhcmdlciB0aGFuIG1heGltdW0gdmFsdWUgZm9yIHR5cGUnKVxuICBhc3NlcnQoTWF0aC5mbG9vcih2YWx1ZSkgPT09IHZhbHVlLCAndmFsdWUgaGFzIGEgZnJhY3Rpb25hbCBjb21wb25lbnQnKVxufVxuXG5mdW5jdGlvbiB2ZXJpZnNpbnQgKHZhbHVlLCBtYXgsIG1pbikge1xuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJywgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKVxuICBhc3NlcnQodmFsdWUgPD0gbWF4LCAndmFsdWUgbGFyZ2VyIHRoYW4gbWF4aW11bSBhbGxvd2VkIHZhbHVlJylcbiAgYXNzZXJ0KHZhbHVlID49IG1pbiwgJ3ZhbHVlIHNtYWxsZXIgdGhhbiBtaW5pbXVtIGFsbG93ZWQgdmFsdWUnKVxuICBhc3NlcnQoTWF0aC5mbG9vcih2YWx1ZSkgPT09IHZhbHVlLCAndmFsdWUgaGFzIGEgZnJhY3Rpb25hbCBjb21wb25lbnQnKVxufVxuXG5mdW5jdGlvbiB2ZXJpZklFRUU3NTQgKHZhbHVlLCBtYXgsIG1pbikge1xuICBhc3NlcnQodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJywgJ2Nhbm5vdCB3cml0ZSBhIG5vbi1udW1iZXIgYXMgYSBudW1iZXInKVxuICBhc3NlcnQodmFsdWUgPD0gbWF4LCAndmFsdWUgbGFyZ2VyIHRoYW4gbWF4aW11bSBhbGxvd2VkIHZhbHVlJylcbiAgYXNzZXJ0KHZhbHVlID49IG1pbiwgJ3ZhbHVlIHNtYWxsZXIgdGhhbiBtaW5pbXVtIGFsbG93ZWQgdmFsdWUnKVxufVxuXG5mdW5jdGlvbiBhc3NlcnQgKHRlc3QsIG1lc3NhZ2UpIHtcbiAgaWYgKCF0ZXN0KSB0aHJvdyBuZXcgRXJyb3IobWVzc2FnZSB8fCAnRmFpbGVkIGFzc2VydGlvbicpXG59XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiVkNtRXN3XCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi5cXFxcbm9kZV9tb2R1bGVzXFxcXGd1bHAtYnJvd3NlcmlmeVxcXFxub2RlX21vZHVsZXNcXFxcYnJvd3NlcmlmeVxcXFxub2RlX21vZHVsZXNcXFxcYnVmZmVyXFxcXGluZGV4LmpzXCIsXCIvLi5cXFxcbm9kZV9tb2R1bGVzXFxcXGd1bHAtYnJvd3NlcmlmeVxcXFxub2RlX21vZHVsZXNcXFxcYnJvd3NlcmlmeVxcXFxub2RlX21vZHVsZXNcXFxcYnVmZmVyXCIpIiwiKGZ1bmN0aW9uIChwcm9jZXNzLGdsb2JhbCxCdWZmZXIsX19hcmd1bWVudDAsX19hcmd1bWVudDEsX19hcmd1bWVudDIsX19hcmd1bWVudDMsX19maWxlbmFtZSxfX2Rpcm5hbWUpe1xudmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiVkNtRXN3XCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvLi5cXFxcbm9kZV9tb2R1bGVzXFxcXGd1bHAtYnJvd3NlcmlmeVxcXFxub2RlX21vZHVsZXNcXFxcYnJvd3NlcmlmeVxcXFxub2RlX21vZHVsZXNcXFxcYnVmZmVyXFxcXG5vZGVfbW9kdWxlc1xcXFxiYXNlNjQtanNcXFxcbGliXFxcXGI2NC5qc1wiLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFxndWxwLWJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJ1ZmZlclxcXFxub2RlX21vZHVsZXNcXFxcYmFzZTY0LWpzXFxcXGxpYlwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbmV4cG9ydHMucmVhZCA9IGZ1bmN0aW9uIChidWZmZXIsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgbkJpdHMgPSAtN1xuICB2YXIgaSA9IGlzTEUgPyAobkJ5dGVzIC0gMSkgOiAwXG4gIHZhciBkID0gaXNMRSA/IC0xIDogMVxuICB2YXIgcyA9IGJ1ZmZlcltvZmZzZXQgKyBpXVxuXG4gIGkgKz0gZFxuXG4gIGUgPSBzICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIHMgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IGVMZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgZSA9IGUgKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBtID0gZSAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBlID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBtTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IG0gPSBtICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgaWYgKGUgPT09IDApIHtcbiAgICBlID0gMSAtIGVCaWFzXG4gIH0gZWxzZSBpZiAoZSA9PT0gZU1heCkge1xuICAgIHJldHVybiBtID8gTmFOIDogKChzID8gLTEgOiAxKSAqIEluZmluaXR5KVxuICB9IGVsc2Uge1xuICAgIG0gPSBtICsgTWF0aC5wb3coMiwgbUxlbilcbiAgICBlID0gZSAtIGVCaWFzXG4gIH1cbiAgcmV0dXJuIChzID8gLTEgOiAxKSAqIG0gKiBNYXRoLnBvdygyLCBlIC0gbUxlbilcbn1cblxuZXhwb3J0cy53cml0ZSA9IGZ1bmN0aW9uIChidWZmZXIsIHZhbHVlLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbSwgY1xuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIHJ0ID0gKG1MZW4gPT09IDIzID8gTWF0aC5wb3coMiwgLTI0KSAtIE1hdGgucG93KDIsIC03NykgOiAwKVxuICB2YXIgaSA9IGlzTEUgPyAwIDogKG5CeXRlcyAtIDEpXG4gIHZhciBkID0gaXNMRSA/IDEgOiAtMVxuICB2YXIgcyA9IHZhbHVlIDwgMCB8fCAodmFsdWUgPT09IDAgJiYgMSAvIHZhbHVlIDwgMCkgPyAxIDogMFxuXG4gIHZhbHVlID0gTWF0aC5hYnModmFsdWUpXG5cbiAgaWYgKGlzTmFOKHZhbHVlKSB8fCB2YWx1ZSA9PT0gSW5maW5pdHkpIHtcbiAgICBtID0gaXNOYU4odmFsdWUpID8gMSA6IDBcbiAgICBlID0gZU1heFxuICB9IGVsc2Uge1xuICAgIGUgPSBNYXRoLmZsb29yKE1hdGgubG9nKHZhbHVlKSAvIE1hdGguTE4yKVxuICAgIGlmICh2YWx1ZSAqIChjID0gTWF0aC5wb3coMiwgLWUpKSA8IDEpIHtcbiAgICAgIGUtLVxuICAgICAgYyAqPSAyXG4gICAgfVxuICAgIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgdmFsdWUgKz0gcnQgLyBjXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbHVlICs9IHJ0ICogTWF0aC5wb3coMiwgMSAtIGVCaWFzKVxuICAgIH1cbiAgICBpZiAodmFsdWUgKiBjID49IDIpIHtcbiAgICAgIGUrK1xuICAgICAgYyAvPSAyXG4gICAgfVxuXG4gICAgaWYgKGUgKyBlQmlhcyA+PSBlTWF4KSB7XG4gICAgICBtID0gMFxuICAgICAgZSA9IGVNYXhcbiAgICB9IGVsc2UgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICBtID0gKHZhbHVlICogYyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSBlICsgZUJpYXNcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IHZhbHVlICogTWF0aC5wb3coMiwgZUJpYXMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gMFxuICAgIH1cbiAgfVxuXG4gIGZvciAoOyBtTGVuID49IDg7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IG0gJiAweGZmLCBpICs9IGQsIG0gLz0gMjU2LCBtTGVuIC09IDgpIHt9XG5cbiAgZSA9IChlIDw8IG1MZW4pIHwgbVxuICBlTGVuICs9IG1MZW5cbiAgZm9yICg7IGVMZW4gPiAwOyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBlICYgMHhmZiwgaSArPSBkLCBlIC89IDI1NiwgZUxlbiAtPSA4KSB7fVxuXG4gIGJ1ZmZlcltvZmZzZXQgKyBpIC0gZF0gfD0gcyAqIDEyOFxufVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIlZDbUVzd1wiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFxndWxwLWJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJ1ZmZlclxcXFxub2RlX21vZHVsZXNcXFxcaWVlZTc1NFxcXFxpbmRleC5qc1wiLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFxndWxwLWJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJ1ZmZlclxcXFxub2RlX21vZHVsZXNcXFxcaWVlZTc1NFwiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG5cbnByb2Nlc3MubmV4dFRpY2sgPSAoZnVuY3Rpb24gKCkge1xuICAgIHZhciBjYW5TZXRJbW1lZGlhdGUgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgICYmIHdpbmRvdy5zZXRJbW1lZGlhdGU7XG4gICAgdmFyIGNhblBvc3QgPSB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJ1xuICAgICYmIHdpbmRvdy5wb3N0TWVzc2FnZSAmJiB3aW5kb3cuYWRkRXZlbnRMaXN0ZW5lclxuICAgIDtcblxuICAgIGlmIChjYW5TZXRJbW1lZGlhdGUpIHtcbiAgICAgICAgcmV0dXJuIGZ1bmN0aW9uIChmKSB7IHJldHVybiB3aW5kb3cuc2V0SW1tZWRpYXRlKGYpIH07XG4gICAgfVxuXG4gICAgaWYgKGNhblBvc3QpIHtcbiAgICAgICAgdmFyIHF1ZXVlID0gW107XG4gICAgICAgIHdpbmRvdy5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgZnVuY3Rpb24gKGV2KSB7XG4gICAgICAgICAgICB2YXIgc291cmNlID0gZXYuc291cmNlO1xuICAgICAgICAgICAgaWYgKChzb3VyY2UgPT09IHdpbmRvdyB8fCBzb3VyY2UgPT09IG51bGwpICYmIGV2LmRhdGEgPT09ICdwcm9jZXNzLXRpY2snKSB7XG4gICAgICAgICAgICAgICAgZXYuc3RvcFByb3BhZ2F0aW9uKCk7XG4gICAgICAgICAgICAgICAgaWYgKHF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgICAgICAgICAgICAgICAgdmFyIGZuID0gcXVldWUuc2hpZnQoKTtcbiAgICAgICAgICAgICAgICAgICAgZm4oKTtcbiAgICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9XG4gICAgICAgIH0sIHRydWUpO1xuXG4gICAgICAgIHJldHVybiBmdW5jdGlvbiBuZXh0VGljayhmbikge1xuICAgICAgICAgICAgcXVldWUucHVzaChmbik7XG4gICAgICAgICAgICB3aW5kb3cucG9zdE1lc3NhZ2UoJ3Byb2Nlc3MtdGljaycsICcqJyk7XG4gICAgICAgIH07XG4gICAgfVxuXG4gICAgcmV0dXJuIGZ1bmN0aW9uIG5leHRUaWNrKGZuKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZm4sIDApO1xuICAgIH07XG59KSgpO1xuXG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcblxuZnVuY3Rpb24gbm9vcCgpIHt9XG5cbnByb2Nlc3Mub24gPSBub29wO1xucHJvY2Vzcy5hZGRMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLm9uY2UgPSBub29wO1xucHJvY2Vzcy5vZmYgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVMaXN0ZW5lciA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUFsbExpc3RlbmVycyA9IG5vb3A7XG5wcm9jZXNzLmVtaXQgPSBub29wO1xuXG5wcm9jZXNzLmJpbmRpbmcgPSBmdW5jdGlvbiAobmFtZSkge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5iaW5kaW5nIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn1cblxuLy8gVE9ETyhzaHR5bG1hbilcbnByb2Nlc3MuY3dkID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gJy8nIH07XG5wcm9jZXNzLmNoZGlyID0gZnVuY3Rpb24gKGRpcikge1xuICAgIHRocm93IG5ldyBFcnJvcigncHJvY2Vzcy5jaGRpciBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIlZDbUVzd1wiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFxndWxwLWJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXHByb2Nlc3NcXFxcYnJvd3Nlci5qc1wiLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFxndWxwLWJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXGJyb3dzZXJpZnlcXFxcbm9kZV9tb2R1bGVzXFxcXHByb2Nlc3NcIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG5mdW5jdGlvbiBET01QYXJzZXIob3B0aW9ucyl7XHJcblx0dGhpcy5vcHRpb25zID0gb3B0aW9ucyB8fHtsb2NhdG9yOnt9fTtcclxuXHRcclxufVxyXG5ET01QYXJzZXIucHJvdG90eXBlLnBhcnNlRnJvbVN0cmluZyA9IGZ1bmN0aW9uKHNvdXJjZSxtaW1lVHlwZSl7XHRcclxuXHR2YXIgb3B0aW9ucyA9IHRoaXMub3B0aW9ucztcclxuXHR2YXIgc2F4ID0gIG5ldyBYTUxSZWFkZXIoKTtcclxuXHR2YXIgZG9tQnVpbGRlciA9IG9wdGlvbnMuZG9tQnVpbGRlciB8fCBuZXcgRE9NSGFuZGxlcigpOy8vY29udGVudEhhbmRsZXIgYW5kIExleGljYWxIYW5kbGVyXHJcblx0dmFyIGVycm9ySGFuZGxlciA9IG9wdGlvbnMuZXJyb3JIYW5kbGVyO1xyXG5cdHZhciBsb2NhdG9yID0gb3B0aW9ucy5sb2NhdG9yO1xyXG5cdHZhciBkZWZhdWx0TlNNYXAgPSBvcHRpb25zLnhtbG5zfHx7fTtcclxuXHR2YXIgZW50aXR5TWFwID0geydsdCc6JzwnLCdndCc6Jz4nLCdhbXAnOicmJywncXVvdCc6J1wiJywnYXBvcyc6XCInXCJ9XHJcblx0aWYobG9jYXRvcil7XHJcblx0XHRkb21CdWlsZGVyLnNldERvY3VtZW50TG9jYXRvcihsb2NhdG9yKVxyXG5cdH1cclxuXHRcclxuXHRzYXguZXJyb3JIYW5kbGVyID0gYnVpbGRFcnJvckhhbmRsZXIoZXJyb3JIYW5kbGVyLGRvbUJ1aWxkZXIsbG9jYXRvcik7XHJcblx0c2F4LmRvbUJ1aWxkZXIgPSBvcHRpb25zLmRvbUJ1aWxkZXIgfHwgZG9tQnVpbGRlcjtcclxuXHRpZigvXFwveD9odG1sPyQvLnRlc3QobWltZVR5cGUpKXtcclxuXHRcdGVudGl0eU1hcC5uYnNwID0gJ1xceGEwJztcclxuXHRcdGVudGl0eU1hcC5jb3B5ID0gJ1xceGE5JztcclxuXHRcdGRlZmF1bHROU01hcFsnJ109ICdodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hodG1sJztcclxuXHR9XHJcblx0aWYoc291cmNlKXtcclxuXHRcdHNheC5wYXJzZShzb3VyY2UsZGVmYXVsdE5TTWFwLGVudGl0eU1hcCk7XHJcblx0fWVsc2V7XHJcblx0XHRzYXguZXJyb3JIYW5kbGVyLmVycm9yKFwiaW52YWxpZCBkb2N1bWVudCBzb3VyY2VcIik7XHJcblx0fVxyXG5cdHJldHVybiBkb21CdWlsZGVyLmRvY3VtZW50O1xyXG59XHJcbmZ1bmN0aW9uIGJ1aWxkRXJyb3JIYW5kbGVyKGVycm9ySW1wbCxkb21CdWlsZGVyLGxvY2F0b3Ipe1xyXG5cdGlmKCFlcnJvckltcGwpe1xyXG5cdFx0aWYoZG9tQnVpbGRlciBpbnN0YW5jZW9mIERPTUhhbmRsZXIpe1xyXG5cdFx0XHRyZXR1cm4gZG9tQnVpbGRlcjtcclxuXHRcdH1cclxuXHRcdGVycm9ySW1wbCA9IGRvbUJ1aWxkZXIgO1xyXG5cdH1cclxuXHR2YXIgZXJyb3JIYW5kbGVyID0ge31cclxuXHR2YXIgaXNDYWxsYmFjayA9IGVycm9ySW1wbCBpbnN0YW5jZW9mIEZ1bmN0aW9uO1xyXG5cdGxvY2F0b3IgPSBsb2NhdG9yfHx7fVxyXG5cdGZ1bmN0aW9uIGJ1aWxkKGtleSl7XHJcblx0XHR2YXIgZm4gPSBlcnJvckltcGxba2V5XTtcclxuXHRcdGlmKCFmbil7XHJcblx0XHRcdGlmKGlzQ2FsbGJhY2spe1xyXG5cdFx0XHRcdGZuID0gZXJyb3JJbXBsLmxlbmd0aCA9PSAyP2Z1bmN0aW9uKG1zZyl7ZXJyb3JJbXBsKGtleSxtc2cpfTplcnJvckltcGw7XHJcblx0XHRcdH1lbHNle1xyXG5cdFx0XHRcdHZhciBpPWFyZ3VtZW50cy5sZW5ndGg7XHJcblx0XHRcdFx0d2hpbGUoLS1pKXtcclxuXHRcdFx0XHRcdGlmKGZuID0gZXJyb3JJbXBsW2FyZ3VtZW50c1tpXV0pe1xyXG5cdFx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdGVycm9ySGFuZGxlcltrZXldID0gZm4gJiYgZnVuY3Rpb24obXNnKXtcclxuXHRcdFx0Zm4obXNnK19sb2NhdG9yKGxvY2F0b3IpKTtcclxuXHRcdH18fGZ1bmN0aW9uKCl7fTtcclxuXHR9XHJcblx0YnVpbGQoJ3dhcm5pbmcnLCd3YXJuJyk7XHJcblx0YnVpbGQoJ2Vycm9yJywnd2FybicsJ3dhcm5pbmcnKTtcclxuXHRidWlsZCgnZmF0YWxFcnJvcicsJ3dhcm4nLCd3YXJuaW5nJywnZXJyb3InKTtcclxuXHRyZXR1cm4gZXJyb3JIYW5kbGVyO1xyXG59XHJcbi8qKlxyXG4gKiArQ29udGVudEhhbmRsZXIrRXJyb3JIYW5kbGVyXHJcbiAqICtMZXhpY2FsSGFuZGxlcitFbnRpdHlSZXNvbHZlcjJcclxuICogLURlY2xIYW5kbGVyLURUREhhbmRsZXIgXHJcbiAqIFxyXG4gKiBEZWZhdWx0SGFuZGxlcjpFbnRpdHlSZXNvbHZlciwgRFRESGFuZGxlciwgQ29udGVudEhhbmRsZXIsIEVycm9ySGFuZGxlclxyXG4gKiBEZWZhdWx0SGFuZGxlcjI6RGVmYXVsdEhhbmRsZXIsTGV4aWNhbEhhbmRsZXIsIERlY2xIYW5kbGVyLCBFbnRpdHlSZXNvbHZlcjJcclxuICogQGxpbmsgaHR0cDovL3d3dy5zYXhwcm9qZWN0Lm9yZy9hcGlkb2Mvb3JnL3htbC9zYXgvaGVscGVycy9EZWZhdWx0SGFuZGxlci5odG1sXHJcbiAqL1xyXG5mdW5jdGlvbiBET01IYW5kbGVyKCkge1xyXG4gICAgdGhpcy5jZGF0YSA9IGZhbHNlO1xyXG59XHJcbmZ1bmN0aW9uIHBvc2l0aW9uKGxvY2F0b3Isbm9kZSl7XHJcblx0bm9kZS5saW5lTnVtYmVyID0gbG9jYXRvci5saW5lTnVtYmVyO1xyXG5cdG5vZGUuY29sdW1uTnVtYmVyID0gbG9jYXRvci5jb2x1bW5OdW1iZXI7XHJcbn1cclxuLyoqXHJcbiAqIEBzZWUgb3JnLnhtbC5zYXguQ29udGVudEhhbmRsZXIjc3RhcnREb2N1bWVudFxyXG4gKiBAbGluayBodHRwOi8vd3d3LnNheHByb2plY3Qub3JnL2FwaWRvYy9vcmcveG1sL3NheC9Db250ZW50SGFuZGxlci5odG1sXHJcbiAqLyBcclxuRE9NSGFuZGxlci5wcm90b3R5cGUgPSB7XHJcblx0c3RhcnREb2N1bWVudCA6IGZ1bmN0aW9uKCkge1xyXG4gICAgXHR0aGlzLmRvY3VtZW50ID0gbmV3IERPTUltcGxlbWVudGF0aW9uKCkuY3JlYXRlRG9jdW1lbnQobnVsbCwgbnVsbCwgbnVsbCk7XHJcbiAgICBcdGlmICh0aGlzLmxvY2F0b3IpIHtcclxuICAgICAgICBcdHRoaXMuZG9jdW1lbnQuZG9jdW1lbnRVUkkgPSB0aGlzLmxvY2F0b3Iuc3lzdGVtSWQ7XHJcbiAgICBcdH1cclxuXHR9LFxyXG5cdHN0YXJ0RWxlbWVudDpmdW5jdGlvbihuYW1lc3BhY2VVUkksIGxvY2FsTmFtZSwgcU5hbWUsIGF0dHJzKSB7XHJcblx0XHR2YXIgZG9jID0gdGhpcy5kb2N1bWVudDtcclxuXHQgICAgdmFyIGVsID0gZG9jLmNyZWF0ZUVsZW1lbnROUyhuYW1lc3BhY2VVUkksIHFOYW1lfHxsb2NhbE5hbWUpO1xyXG5cdCAgICB2YXIgbGVuID0gYXR0cnMubGVuZ3RoO1xyXG5cdCAgICBhcHBlbmRFbGVtZW50KHRoaXMsIGVsKTtcclxuXHQgICAgdGhpcy5jdXJyZW50RWxlbWVudCA9IGVsO1xyXG5cdCAgICBcclxuXHRcdHRoaXMubG9jYXRvciAmJiBwb3NpdGlvbih0aGlzLmxvY2F0b3IsZWwpXHJcblx0ICAgIGZvciAodmFyIGkgPSAwIDsgaSA8IGxlbjsgaSsrKSB7XHJcblx0ICAgICAgICB2YXIgbmFtZXNwYWNlVVJJID0gYXR0cnMuZ2V0VVJJKGkpO1xyXG5cdCAgICAgICAgdmFyIHZhbHVlID0gYXR0cnMuZ2V0VmFsdWUoaSk7XHJcblx0ICAgICAgICB2YXIgcU5hbWUgPSBhdHRycy5nZXRRTmFtZShpKTtcclxuXHRcdFx0dmFyIGF0dHIgPSBkb2MuY3JlYXRlQXR0cmlidXRlTlMobmFtZXNwYWNlVVJJLCBxTmFtZSk7XHJcblx0XHRcdGlmKCBhdHRyLmdldE9mZnNldCl7XHJcblx0XHRcdFx0cG9zaXRpb24oYXR0ci5nZXRPZmZzZXQoMSksYXR0cilcclxuXHRcdFx0fVxyXG5cdFx0XHRhdHRyLnZhbHVlID0gYXR0ci5ub2RlVmFsdWUgPSB2YWx1ZTtcclxuXHRcdFx0ZWwuc2V0QXR0cmlidXRlTm9kZShhdHRyKVxyXG5cdCAgICB9XHJcblx0fSxcclxuXHRlbmRFbGVtZW50OmZ1bmN0aW9uKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lLCBxTmFtZSkge1xyXG5cdFx0dmFyIGN1cnJlbnQgPSB0aGlzLmN1cnJlbnRFbGVtZW50XHJcblx0ICAgIHZhciB0YWdOYW1lID0gY3VycmVudC50YWdOYW1lO1xyXG5cdCAgICB0aGlzLmN1cnJlbnRFbGVtZW50ID0gY3VycmVudC5wYXJlbnROb2RlO1xyXG5cdH0sXHJcblx0c3RhcnRQcmVmaXhNYXBwaW5nOmZ1bmN0aW9uKHByZWZpeCwgdXJpKSB7XHJcblx0fSxcclxuXHRlbmRQcmVmaXhNYXBwaW5nOmZ1bmN0aW9uKHByZWZpeCkge1xyXG5cdH0sXHJcblx0cHJvY2Vzc2luZ0luc3RydWN0aW9uOmZ1bmN0aW9uKHRhcmdldCwgZGF0YSkge1xyXG5cdCAgICB2YXIgaW5zID0gdGhpcy5kb2N1bWVudC5jcmVhdGVQcm9jZXNzaW5nSW5zdHJ1Y3Rpb24odGFyZ2V0LCBkYXRhKTtcclxuXHQgICAgdGhpcy5sb2NhdG9yICYmIHBvc2l0aW9uKHRoaXMubG9jYXRvcixpbnMpXHJcblx0ICAgIGFwcGVuZEVsZW1lbnQodGhpcywgaW5zKTtcclxuXHR9LFxyXG5cdGlnbm9yYWJsZVdoaXRlc3BhY2U6ZnVuY3Rpb24oY2gsIHN0YXJ0LCBsZW5ndGgpIHtcclxuXHR9LFxyXG5cdGNoYXJhY3RlcnM6ZnVuY3Rpb24oY2hhcnMsIHN0YXJ0LCBsZW5ndGgpIHtcclxuXHRcdGNoYXJzID0gX3RvU3RyaW5nLmFwcGx5KHRoaXMsYXJndW1lbnRzKVxyXG5cdFx0Ly9jb25zb2xlLmxvZyhjaGFycylcclxuXHRcdGlmKHRoaXMuY3VycmVudEVsZW1lbnQgJiYgY2hhcnMpe1xyXG5cdFx0XHRpZiAodGhpcy5jZGF0YSkge1xyXG5cdFx0XHRcdHZhciBjaGFyTm9kZSA9IHRoaXMuZG9jdW1lbnQuY3JlYXRlQ0RBVEFTZWN0aW9uKGNoYXJzKTtcclxuXHRcdFx0XHR0aGlzLmN1cnJlbnRFbGVtZW50LmFwcGVuZENoaWxkKGNoYXJOb2RlKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHR2YXIgY2hhck5vZGUgPSB0aGlzLmRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGNoYXJzKTtcclxuXHRcdFx0XHR0aGlzLmN1cnJlbnRFbGVtZW50LmFwcGVuZENoaWxkKGNoYXJOb2RlKTtcclxuXHRcdFx0fVxyXG5cdFx0XHR0aGlzLmxvY2F0b3IgJiYgcG9zaXRpb24odGhpcy5sb2NhdG9yLGNoYXJOb2RlKVxyXG5cdFx0fVxyXG5cdH0sXHJcblx0c2tpcHBlZEVudGl0eTpmdW5jdGlvbihuYW1lKSB7XHJcblx0fSxcclxuXHRlbmREb2N1bWVudDpmdW5jdGlvbigpIHtcclxuXHRcdHRoaXMuZG9jdW1lbnQubm9ybWFsaXplKCk7XHJcblx0fSxcclxuXHRzZXREb2N1bWVudExvY2F0b3I6ZnVuY3Rpb24gKGxvY2F0b3IpIHtcclxuXHQgICAgaWYodGhpcy5sb2NhdG9yID0gbG9jYXRvcil7Ly8gJiYgISgnbGluZU51bWJlcicgaW4gbG9jYXRvcikpe1xyXG5cdCAgICBcdGxvY2F0b3IubGluZU51bWJlciA9IDA7XHJcblx0ICAgIH1cclxuXHR9LFxyXG5cdC8vTGV4aWNhbEhhbmRsZXJcclxuXHRjb21tZW50OmZ1bmN0aW9uKGNoYXJzLCBzdGFydCwgbGVuZ3RoKSB7XHJcblx0XHRjaGFycyA9IF90b1N0cmluZy5hcHBseSh0aGlzLGFyZ3VtZW50cylcclxuXHQgICAgdmFyIGNvbW0gPSB0aGlzLmRvY3VtZW50LmNyZWF0ZUNvbW1lbnQoY2hhcnMpO1xyXG5cdCAgICB0aGlzLmxvY2F0b3IgJiYgcG9zaXRpb24odGhpcy5sb2NhdG9yLGNvbW0pXHJcblx0ICAgIGFwcGVuZEVsZW1lbnQodGhpcywgY29tbSk7XHJcblx0fSxcclxuXHRcclxuXHRzdGFydENEQVRBOmZ1bmN0aW9uKCkge1xyXG5cdCAgICAvL3VzZWQgaW4gY2hhcmFjdGVycygpIG1ldGhvZHNcclxuXHQgICAgdGhpcy5jZGF0YSA9IHRydWU7XHJcblx0fSxcclxuXHRlbmRDREFUQTpmdW5jdGlvbigpIHtcclxuXHQgICAgdGhpcy5jZGF0YSA9IGZhbHNlO1xyXG5cdH0sXHJcblx0XHJcblx0c3RhcnREVEQ6ZnVuY3Rpb24obmFtZSwgcHVibGljSWQsIHN5c3RlbUlkKSB7XHJcblx0XHR2YXIgaW1wbCA9IHRoaXMuZG9jdW1lbnQuaW1wbGVtZW50YXRpb247XHJcblx0ICAgIGlmIChpbXBsICYmIGltcGwuY3JlYXRlRG9jdW1lbnRUeXBlKSB7XHJcblx0ICAgICAgICB2YXIgZHQgPSBpbXBsLmNyZWF0ZURvY3VtZW50VHlwZShuYW1lLCBwdWJsaWNJZCwgc3lzdGVtSWQpO1xyXG5cdCAgICAgICAgdGhpcy5sb2NhdG9yICYmIHBvc2l0aW9uKHRoaXMubG9jYXRvcixkdClcclxuXHQgICAgICAgIGFwcGVuZEVsZW1lbnQodGhpcywgZHQpO1xyXG5cdCAgICB9XHJcblx0fSxcclxuXHQvKipcclxuXHQgKiBAc2VlIG9yZy54bWwuc2F4LkVycm9ySGFuZGxlclxyXG5cdCAqIEBsaW5rIGh0dHA6Ly93d3cuc2F4cHJvamVjdC5vcmcvYXBpZG9jL29yZy94bWwvc2F4L0Vycm9ySGFuZGxlci5odG1sXHJcblx0ICovXHJcblx0d2FybmluZzpmdW5jdGlvbihlcnJvcikge1xyXG5cdFx0Y29uc29sZS53YXJuKGVycm9yLF9sb2NhdG9yKHRoaXMubG9jYXRvcikpO1xyXG5cdH0sXHJcblx0ZXJyb3I6ZnVuY3Rpb24oZXJyb3IpIHtcclxuXHRcdGNvbnNvbGUuZXJyb3IoZXJyb3IsX2xvY2F0b3IodGhpcy5sb2NhdG9yKSk7XHJcblx0fSxcclxuXHRmYXRhbEVycm9yOmZ1bmN0aW9uKGVycm9yKSB7XHJcblx0XHRjb25zb2xlLmVycm9yKGVycm9yLF9sb2NhdG9yKHRoaXMubG9jYXRvcikpO1xyXG5cdCAgICB0aHJvdyBlcnJvcjtcclxuXHR9XHJcbn1cclxuZnVuY3Rpb24gX2xvY2F0b3IobCl7XHJcblx0aWYobCl7XHJcblx0XHRyZXR1cm4gJ1xcbkAnKyhsLnN5c3RlbUlkIHx8JycpKycjW2xpbmU6JytsLmxpbmVOdW1iZXIrJyxjb2w6JytsLmNvbHVtbk51bWJlcisnXSdcclxuXHR9XHJcbn1cclxuZnVuY3Rpb24gX3RvU3RyaW5nKGNoYXJzLHN0YXJ0LGxlbmd0aCl7XHJcblx0aWYodHlwZW9mIGNoYXJzID09ICdzdHJpbmcnKXtcclxuXHRcdHJldHVybiBjaGFycy5zdWJzdHIoc3RhcnQsbGVuZ3RoKVxyXG5cdH1lbHNley8vamF2YSBzYXggY29ubmVjdCB3aWR0aCB4bWxkb20gb24gcmhpbm8od2hhdCBhYm91dDogXCI/ICYmICEoY2hhcnMgaW5zdGFuY2VvZiBTdHJpbmcpXCIpXHJcblx0XHRpZihjaGFycy5sZW5ndGggPj0gc3RhcnQrbGVuZ3RoIHx8IHN0YXJ0KXtcclxuXHRcdFx0cmV0dXJuIG5ldyBqYXZhLmxhbmcuU3RyaW5nKGNoYXJzLHN0YXJ0LGxlbmd0aCkrJyc7XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gY2hhcnM7XHJcblx0fVxyXG59XHJcblxyXG4vKlxyXG4gKiBAbGluayBodHRwOi8vd3d3LnNheHByb2plY3Qub3JnL2FwaWRvYy9vcmcveG1sL3NheC9leHQvTGV4aWNhbEhhbmRsZXIuaHRtbFxyXG4gKiB1c2VkIG1ldGhvZCBvZiBvcmcueG1sLnNheC5leHQuTGV4aWNhbEhhbmRsZXI6XHJcbiAqICAjY29tbWVudChjaGFycywgc3RhcnQsIGxlbmd0aClcclxuICogICNzdGFydENEQVRBKClcclxuICogICNlbmRDREFUQSgpXHJcbiAqICAjc3RhcnREVEQobmFtZSwgcHVibGljSWQsIHN5c3RlbUlkKVxyXG4gKlxyXG4gKlxyXG4gKiBJR05PUkVEIG1ldGhvZCBvZiBvcmcueG1sLnNheC5leHQuTGV4aWNhbEhhbmRsZXI6XHJcbiAqICAjZW5kRFREKClcclxuICogICNzdGFydEVudGl0eShuYW1lKVxyXG4gKiAgI2VuZEVudGl0eShuYW1lKVxyXG4gKlxyXG4gKlxyXG4gKiBAbGluayBodHRwOi8vd3d3LnNheHByb2plY3Qub3JnL2FwaWRvYy9vcmcveG1sL3NheC9leHQvRGVjbEhhbmRsZXIuaHRtbFxyXG4gKiBJR05PUkVEIG1ldGhvZCBvZiBvcmcueG1sLnNheC5leHQuRGVjbEhhbmRsZXJcclxuICogXHQjYXR0cmlidXRlRGVjbChlTmFtZSwgYU5hbWUsIHR5cGUsIG1vZGUsIHZhbHVlKVxyXG4gKiAgI2VsZW1lbnREZWNsKG5hbWUsIG1vZGVsKVxyXG4gKiAgI2V4dGVybmFsRW50aXR5RGVjbChuYW1lLCBwdWJsaWNJZCwgc3lzdGVtSWQpXHJcbiAqICAjaW50ZXJuYWxFbnRpdHlEZWNsKG5hbWUsIHZhbHVlKVxyXG4gKiBAbGluayBodHRwOi8vd3d3LnNheHByb2plY3Qub3JnL2FwaWRvYy9vcmcveG1sL3NheC9leHQvRW50aXR5UmVzb2x2ZXIyLmh0bWxcclxuICogSUdOT1JFRCBtZXRob2Qgb2Ygb3JnLnhtbC5zYXguRW50aXR5UmVzb2x2ZXIyXHJcbiAqICAjcmVzb2x2ZUVudGl0eShTdHJpbmcgbmFtZSxTdHJpbmcgcHVibGljSWQsU3RyaW5nIGJhc2VVUkksU3RyaW5nIHN5c3RlbUlkKVxyXG4gKiAgI3Jlc29sdmVFbnRpdHkocHVibGljSWQsIHN5c3RlbUlkKVxyXG4gKiAgI2dldEV4dGVybmFsU3Vic2V0KG5hbWUsIGJhc2VVUkkpXHJcbiAqIEBsaW5rIGh0dHA6Ly93d3cuc2F4cHJvamVjdC5vcmcvYXBpZG9jL29yZy94bWwvc2F4L0RUREhhbmRsZXIuaHRtbFxyXG4gKiBJR05PUkVEIG1ldGhvZCBvZiBvcmcueG1sLnNheC5EVERIYW5kbGVyXHJcbiAqICAjbm90YXRpb25EZWNsKG5hbWUsIHB1YmxpY0lkLCBzeXN0ZW1JZCkge307XHJcbiAqICAjdW5wYXJzZWRFbnRpdHlEZWNsKG5hbWUsIHB1YmxpY0lkLCBzeXN0ZW1JZCwgbm90YXRpb25OYW1lKSB7fTtcclxuICovXHJcblwiZW5kRFRELHN0YXJ0RW50aXR5LGVuZEVudGl0eSxhdHRyaWJ1dGVEZWNsLGVsZW1lbnREZWNsLGV4dGVybmFsRW50aXR5RGVjbCxpbnRlcm5hbEVudGl0eURlY2wscmVzb2x2ZUVudGl0eSxnZXRFeHRlcm5hbFN1YnNldCxub3RhdGlvbkRlY2wsdW5wYXJzZWRFbnRpdHlEZWNsXCIucmVwbGFjZSgvXFx3Ky9nLGZ1bmN0aW9uKGtleSl7XHJcblx0RE9NSGFuZGxlci5wcm90b3R5cGVba2V5XSA9IGZ1bmN0aW9uKCl7cmV0dXJuIG51bGx9XHJcbn0pXHJcblxyXG4vKiBQcml2YXRlIHN0YXRpYyBoZWxwZXJzIHRyZWF0ZWQgYmVsb3cgYXMgcHJpdmF0ZSBpbnN0YW5jZSBtZXRob2RzLCBzbyBkb24ndCBuZWVkIHRvIGFkZCB0aGVzZSB0byB0aGUgcHVibGljIEFQSTsgd2UgbWlnaHQgdXNlIGEgUmVsYXRvciB0byBhbHNvIGdldCByaWQgb2Ygbm9uLXN0YW5kYXJkIHB1YmxpYyBwcm9wZXJ0aWVzICovXHJcbmZ1bmN0aW9uIGFwcGVuZEVsZW1lbnQgKGhhbmRlcixub2RlKSB7XHJcbiAgICBpZiAoIWhhbmRlci5jdXJyZW50RWxlbWVudCkge1xyXG4gICAgICAgIGhhbmRlci5kb2N1bWVudC5hcHBlbmRDaGlsZChub2RlKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgICAgaGFuZGVyLmN1cnJlbnRFbGVtZW50LmFwcGVuZENoaWxkKG5vZGUpO1xyXG4gICAgfVxyXG59Ly9hcHBlbmRDaGlsZCBhbmQgc2V0QXR0cmlidXRlTlMgYXJlIHByZWZvcm1hbmNlIGtleVxyXG5cclxuaWYodHlwZW9mIHJlcXVpcmUgPT0gJ2Z1bmN0aW9uJyl7XHJcblx0dmFyIFhNTFJlYWRlciA9IHJlcXVpcmUoJy4vc2F4JykuWE1MUmVhZGVyO1xyXG5cdHZhciBET01JbXBsZW1lbnRhdGlvbiA9IGV4cG9ydHMuRE9NSW1wbGVtZW50YXRpb24gPSByZXF1aXJlKCcuL2RvbScpLkRPTUltcGxlbWVudGF0aW9uO1xyXG5cdGV4cG9ydHMuWE1MU2VyaWFsaXplciA9IHJlcXVpcmUoJy4vZG9tJykuWE1MU2VyaWFsaXplciA7XHJcblx0ZXhwb3J0cy5ET01QYXJzZXIgPSBET01QYXJzZXI7XHJcbn1cclxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIlZDbUVzd1wiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFx4bWxkb21cXFxcZG9tLXBhcnNlci5qc1wiLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFx4bWxkb21cIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vKlxuICogRE9NIExldmVsIDJcbiAqIE9iamVjdCBET01FeGNlcHRpb25cbiAqIEBzZWUgaHR0cDovL3d3dy53My5vcmcvVFIvUkVDLURPTS1MZXZlbC0xL2VjbWEtc2NyaXB0LWxhbmd1YWdlLWJpbmRpbmcuaHRtbFxuICogQHNlZSBodHRwOi8vd3d3LnczLm9yZy9UUi8yMDAwL1JFQy1ET00tTGV2ZWwtMi1Db3JlLTIwMDAxMTEzL2VjbWEtc2NyaXB0LWJpbmRpbmcuaHRtbFxuICovXG5cbmZ1bmN0aW9uIGNvcHkoc3JjLGRlc3Qpe1xuXHRmb3IodmFyIHAgaW4gc3JjKXtcblx0XHRkZXN0W3BdID0gc3JjW3BdO1xuXHR9XG59XG4vKipcbl5cXHcrXFwucHJvdG90eXBlXFwuKFtfXFx3XSspXFxzKj1cXHMqKCg/Oi4qXFx7XFxzKj9bXFxyXFxuXVtcXHNcXFNdKj9efSl8XFxTLio/KD89WztcXHJcXG5dKSk7P1xuXlxcdytcXC5wcm90b3R5cGVcXC4oW19cXHddKylcXHMqPVxccyooXFxTLio/KD89WztcXHJcXG5dKSk7P1xuICovXG5mdW5jdGlvbiBfZXh0ZW5kcyhDbGFzcyxTdXBlcil7XG5cdHZhciBwdCA9IENsYXNzLnByb3RvdHlwZTtcblx0aWYoT2JqZWN0LmNyZWF0ZSl7XG5cdFx0dmFyIHBwdCA9IE9iamVjdC5jcmVhdGUoU3VwZXIucHJvdG90eXBlKVxuXHRcdHB0Ll9fcHJvdG9fXyA9IHBwdDtcblx0fVxuXHRpZighKHB0IGluc3RhbmNlb2YgU3VwZXIpKXtcblx0XHRmdW5jdGlvbiB0KCl7fTtcblx0XHR0LnByb3RvdHlwZSA9IFN1cGVyLnByb3RvdHlwZTtcblx0XHR0ID0gbmV3IHQoKTtcblx0XHRjb3B5KHB0LHQpO1xuXHRcdENsYXNzLnByb3RvdHlwZSA9IHB0ID0gdDtcblx0fVxuXHRpZihwdC5jb25zdHJ1Y3RvciAhPSBDbGFzcyl7XG5cdFx0aWYodHlwZW9mIENsYXNzICE9ICdmdW5jdGlvbicpe1xuXHRcdFx0Y29uc29sZS5lcnJvcihcInVua25vdyBDbGFzczpcIitDbGFzcylcblx0XHR9XG5cdFx0cHQuY29uc3RydWN0b3IgPSBDbGFzc1xuXHR9XG59XG52YXIgaHRtbG5zID0gJ2h0dHA6Ly93d3cudzMub3JnLzE5OTkveGh0bWwnIDtcbi8vIE5vZGUgVHlwZXNcbnZhciBOb2RlVHlwZSA9IHt9XG52YXIgRUxFTUVOVF9OT0RFICAgICAgICAgICAgICAgID0gTm9kZVR5cGUuRUxFTUVOVF9OT0RFICAgICAgICAgICAgICAgID0gMTtcbnZhciBBVFRSSUJVVEVfTk9ERSAgICAgICAgICAgICAgPSBOb2RlVHlwZS5BVFRSSUJVVEVfTk9ERSAgICAgICAgICAgICAgPSAyO1xudmFyIFRFWFRfTk9ERSAgICAgICAgICAgICAgICAgICA9IE5vZGVUeXBlLlRFWFRfTk9ERSAgICAgICAgICAgICAgICAgICA9IDM7XG52YXIgQ0RBVEFfU0VDVElPTl9OT0RFICAgICAgICAgID0gTm9kZVR5cGUuQ0RBVEFfU0VDVElPTl9OT0RFICAgICAgICAgID0gNDtcbnZhciBFTlRJVFlfUkVGRVJFTkNFX05PREUgICAgICAgPSBOb2RlVHlwZS5FTlRJVFlfUkVGRVJFTkNFX05PREUgICAgICAgPSA1O1xudmFyIEVOVElUWV9OT0RFICAgICAgICAgICAgICAgICA9IE5vZGVUeXBlLkVOVElUWV9OT0RFICAgICAgICAgICAgICAgICA9IDY7XG52YXIgUFJPQ0VTU0lOR19JTlNUUlVDVElPTl9OT0RFID0gTm9kZVR5cGUuUFJPQ0VTU0lOR19JTlNUUlVDVElPTl9OT0RFID0gNztcbnZhciBDT01NRU5UX05PREUgICAgICAgICAgICAgICAgPSBOb2RlVHlwZS5DT01NRU5UX05PREUgICAgICAgICAgICAgICAgPSA4O1xudmFyIERPQ1VNRU5UX05PREUgICAgICAgICAgICAgICA9IE5vZGVUeXBlLkRPQ1VNRU5UX05PREUgICAgICAgICAgICAgICA9IDk7XG52YXIgRE9DVU1FTlRfVFlQRV9OT0RFICAgICAgICAgID0gTm9kZVR5cGUuRE9DVU1FTlRfVFlQRV9OT0RFICAgICAgICAgID0gMTA7XG52YXIgRE9DVU1FTlRfRlJBR01FTlRfTk9ERSAgICAgID0gTm9kZVR5cGUuRE9DVU1FTlRfRlJBR01FTlRfTk9ERSAgICAgID0gMTE7XG52YXIgTk9UQVRJT05fTk9ERSAgICAgICAgICAgICAgID0gTm9kZVR5cGUuTk9UQVRJT05fTk9ERSAgICAgICAgICAgICAgID0gMTI7XG5cbi8vIEV4Y2VwdGlvbkNvZGVcbnZhciBFeGNlcHRpb25Db2RlID0ge31cbnZhciBFeGNlcHRpb25NZXNzYWdlID0ge307XG52YXIgSU5ERVhfU0laRV9FUlIgICAgICAgICAgICAgID0gRXhjZXB0aW9uQ29kZS5JTkRFWF9TSVpFX0VSUiAgICAgICAgICAgICAgPSAoKEV4Y2VwdGlvbk1lc3NhZ2VbMV09XCJJbmRleCBzaXplIGVycm9yXCIpLDEpO1xudmFyIERPTVNUUklOR19TSVpFX0VSUiAgICAgICAgICA9IEV4Y2VwdGlvbkNvZGUuRE9NU1RSSU5HX1NJWkVfRVJSICAgICAgICAgID0gKChFeGNlcHRpb25NZXNzYWdlWzJdPVwiRE9NU3RyaW5nIHNpemUgZXJyb3JcIiksMik7XG52YXIgSElFUkFSQ0hZX1JFUVVFU1RfRVJSICAgICAgID0gRXhjZXB0aW9uQ29kZS5ISUVSQVJDSFlfUkVRVUVTVF9FUlIgICAgICAgPSAoKEV4Y2VwdGlvbk1lc3NhZ2VbM109XCJIaWVyYXJjaHkgcmVxdWVzdCBlcnJvclwiKSwzKTtcbnZhciBXUk9OR19ET0NVTUVOVF9FUlIgICAgICAgICAgPSBFeGNlcHRpb25Db2RlLldST05HX0RPQ1VNRU5UX0VSUiAgICAgICAgICA9ICgoRXhjZXB0aW9uTWVzc2FnZVs0XT1cIldyb25nIGRvY3VtZW50XCIpLDQpO1xudmFyIElOVkFMSURfQ0hBUkFDVEVSX0VSUiAgICAgICA9IEV4Y2VwdGlvbkNvZGUuSU5WQUxJRF9DSEFSQUNURVJfRVJSICAgICAgID0gKChFeGNlcHRpb25NZXNzYWdlWzVdPVwiSW52YWxpZCBjaGFyYWN0ZXJcIiksNSk7XG52YXIgTk9fREFUQV9BTExPV0VEX0VSUiAgICAgICAgID0gRXhjZXB0aW9uQ29kZS5OT19EQVRBX0FMTE9XRURfRVJSICAgICAgICAgPSAoKEV4Y2VwdGlvbk1lc3NhZ2VbNl09XCJObyBkYXRhIGFsbG93ZWRcIiksNik7XG52YXIgTk9fTU9ESUZJQ0FUSU9OX0FMTE9XRURfRVJSID0gRXhjZXB0aW9uQ29kZS5OT19NT0RJRklDQVRJT05fQUxMT1dFRF9FUlIgPSAoKEV4Y2VwdGlvbk1lc3NhZ2VbN109XCJObyBtb2RpZmljYXRpb24gYWxsb3dlZFwiKSw3KTtcbnZhciBOT1RfRk9VTkRfRVJSICAgICAgICAgICAgICAgPSBFeGNlcHRpb25Db2RlLk5PVF9GT1VORF9FUlIgICAgICAgICAgICAgICA9ICgoRXhjZXB0aW9uTWVzc2FnZVs4XT1cIk5vdCBmb3VuZFwiKSw4KTtcbnZhciBOT1RfU1VQUE9SVEVEX0VSUiAgICAgICAgICAgPSBFeGNlcHRpb25Db2RlLk5PVF9TVVBQT1JURURfRVJSICAgICAgICAgICA9ICgoRXhjZXB0aW9uTWVzc2FnZVs5XT1cIk5vdCBzdXBwb3J0ZWRcIiksOSk7XG52YXIgSU5VU0VfQVRUUklCVVRFX0VSUiAgICAgICAgID0gRXhjZXB0aW9uQ29kZS5JTlVTRV9BVFRSSUJVVEVfRVJSICAgICAgICAgPSAoKEV4Y2VwdGlvbk1lc3NhZ2VbMTBdPVwiQXR0cmlidXRlIGluIHVzZVwiKSwxMCk7XG4vL2xldmVsMlxudmFyIElOVkFMSURfU1RBVEVfRVJSICAgICAgICBcdD0gRXhjZXB0aW9uQ29kZS5JTlZBTElEX1NUQVRFX0VSUiAgICAgICAgXHQ9ICgoRXhjZXB0aW9uTWVzc2FnZVsxMV09XCJJbnZhbGlkIHN0YXRlXCIpLDExKTtcbnZhciBTWU5UQVhfRVJSICAgICAgICAgICAgICAgXHQ9IEV4Y2VwdGlvbkNvZGUuU1lOVEFYX0VSUiAgICAgICAgICAgICAgIFx0PSAoKEV4Y2VwdGlvbk1lc3NhZ2VbMTJdPVwiU3ludGF4IGVycm9yXCIpLDEyKTtcbnZhciBJTlZBTElEX01PRElGSUNBVElPTl9FUlIgXHQ9IEV4Y2VwdGlvbkNvZGUuSU5WQUxJRF9NT0RJRklDQVRJT05fRVJSIFx0PSAoKEV4Y2VwdGlvbk1lc3NhZ2VbMTNdPVwiSW52YWxpZCBtb2RpZmljYXRpb25cIiksMTMpO1xudmFyIE5BTUVTUEFDRV9FUlIgICAgICAgICAgICBcdD0gRXhjZXB0aW9uQ29kZS5OQU1FU1BBQ0VfRVJSICAgICAgICAgICBcdD0gKChFeGNlcHRpb25NZXNzYWdlWzE0XT1cIkludmFsaWQgbmFtZXNwYWNlXCIpLDE0KTtcbnZhciBJTlZBTElEX0FDQ0VTU19FUlIgICAgICAgXHQ9IEV4Y2VwdGlvbkNvZGUuSU5WQUxJRF9BQ0NFU1NfRVJSICAgICAgXHQ9ICgoRXhjZXB0aW9uTWVzc2FnZVsxNV09XCJJbnZhbGlkIGFjY2Vzc1wiKSwxNSk7XG5cblxuZnVuY3Rpb24gRE9NRXhjZXB0aW9uKGNvZGUsIG1lc3NhZ2UpIHtcblx0aWYobWVzc2FnZSBpbnN0YW5jZW9mIEVycm9yKXtcblx0XHR2YXIgZXJyb3IgPSBtZXNzYWdlO1xuXHR9ZWxzZXtcblx0XHRlcnJvciA9IHRoaXM7XG5cdFx0RXJyb3IuY2FsbCh0aGlzLCBFeGNlcHRpb25NZXNzYWdlW2NvZGVdKTtcblx0XHR0aGlzLm1lc3NhZ2UgPSBFeGNlcHRpb25NZXNzYWdlW2NvZGVdO1xuXHRcdGlmKEVycm9yLmNhcHR1cmVTdGFja1RyYWNlKSBFcnJvci5jYXB0dXJlU3RhY2tUcmFjZSh0aGlzLCBET01FeGNlcHRpb24pO1xuXHR9XG5cdGVycm9yLmNvZGUgPSBjb2RlO1xuXHRpZihtZXNzYWdlKSB0aGlzLm1lc3NhZ2UgPSB0aGlzLm1lc3NhZ2UgKyBcIjogXCIgKyBtZXNzYWdlO1xuXHRyZXR1cm4gZXJyb3I7XG59O1xuRE9NRXhjZXB0aW9uLnByb3RvdHlwZSA9IEVycm9yLnByb3RvdHlwZTtcbmNvcHkoRXhjZXB0aW9uQ29kZSxET01FeGNlcHRpb24pXG4vKipcbiAqIEBzZWUgaHR0cDovL3d3dy53My5vcmcvVFIvMjAwMC9SRUMtRE9NLUxldmVsLTItQ29yZS0yMDAwMTExMy9jb3JlLmh0bWwjSUQtNTM2Mjk3MTc3XG4gKiBUaGUgTm9kZUxpc3QgaW50ZXJmYWNlIHByb3ZpZGVzIHRoZSBhYnN0cmFjdGlvbiBvZiBhbiBvcmRlcmVkIGNvbGxlY3Rpb24gb2Ygbm9kZXMsIHdpdGhvdXQgZGVmaW5pbmcgb3IgY29uc3RyYWluaW5nIGhvdyB0aGlzIGNvbGxlY3Rpb24gaXMgaW1wbGVtZW50ZWQuIE5vZGVMaXN0IG9iamVjdHMgaW4gdGhlIERPTSBhcmUgbGl2ZS5cbiAqIFRoZSBpdGVtcyBpbiB0aGUgTm9kZUxpc3QgYXJlIGFjY2Vzc2libGUgdmlhIGFuIGludGVncmFsIGluZGV4LCBzdGFydGluZyBmcm9tIDAuXG4gKi9cbmZ1bmN0aW9uIE5vZGVMaXN0KCkge1xufTtcbk5vZGVMaXN0LnByb3RvdHlwZSA9IHtcblx0LyoqXG5cdCAqIFRoZSBudW1iZXIgb2Ygbm9kZXMgaW4gdGhlIGxpc3QuIFRoZSByYW5nZSBvZiB2YWxpZCBjaGlsZCBub2RlIGluZGljZXMgaXMgMCB0byBsZW5ndGgtMSBpbmNsdXNpdmUuXG5cdCAqIEBzdGFuZGFyZCBsZXZlbDFcblx0ICovXG5cdGxlbmd0aDowLCBcblx0LyoqXG5cdCAqIFJldHVybnMgdGhlIGluZGV4dGggaXRlbSBpbiB0aGUgY29sbGVjdGlvbi4gSWYgaW5kZXggaXMgZ3JlYXRlciB0aGFuIG9yIGVxdWFsIHRvIHRoZSBudW1iZXIgb2Ygbm9kZXMgaW4gdGhlIGxpc3QsIHRoaXMgcmV0dXJucyBudWxsLlxuXHQgKiBAc3RhbmRhcmQgbGV2ZWwxXG5cdCAqIEBwYXJhbSBpbmRleCAgdW5zaWduZWQgbG9uZyBcblx0ICogICBJbmRleCBpbnRvIHRoZSBjb2xsZWN0aW9uLlxuXHQgKiBAcmV0dXJuIE5vZGVcblx0ICogXHRUaGUgbm9kZSBhdCB0aGUgaW5kZXh0aCBwb3NpdGlvbiBpbiB0aGUgTm9kZUxpc3QsIG9yIG51bGwgaWYgdGhhdCBpcyBub3QgYSB2YWxpZCBpbmRleC4gXG5cdCAqL1xuXHRpdGVtOiBmdW5jdGlvbihpbmRleCkge1xuXHRcdHJldHVybiB0aGlzW2luZGV4XSB8fCBudWxsO1xuXHR9XG59O1xuZnVuY3Rpb24gTGl2ZU5vZGVMaXN0KG5vZGUscmVmcmVzaCl7XG5cdHRoaXMuX25vZGUgPSBub2RlO1xuXHR0aGlzLl9yZWZyZXNoID0gcmVmcmVzaFxuXHRfdXBkYXRlTGl2ZUxpc3QodGhpcyk7XG59XG5mdW5jdGlvbiBfdXBkYXRlTGl2ZUxpc3QobGlzdCl7XG5cdHZhciBpbmMgPSBsaXN0Ll9ub2RlLl9pbmMgfHwgbGlzdC5fbm9kZS5vd25lckRvY3VtZW50Ll9pbmM7XG5cdGlmKGxpc3QuX2luYyAhPSBpbmMpe1xuXHRcdHZhciBscyA9IGxpc3QuX3JlZnJlc2gobGlzdC5fbm9kZSk7XG5cdFx0Ly9jb25zb2xlLmxvZyhscy5sZW5ndGgpXG5cdFx0X19zZXRfXyhsaXN0LCdsZW5ndGgnLGxzLmxlbmd0aCk7XG5cdFx0Y29weShscyxsaXN0KTtcblx0XHRsaXN0Ll9pbmMgPSBpbmM7XG5cdH1cbn1cbkxpdmVOb2RlTGlzdC5wcm90b3R5cGUuaXRlbSA9IGZ1bmN0aW9uKGkpe1xuXHRfdXBkYXRlTGl2ZUxpc3QodGhpcyk7XG5cdHJldHVybiB0aGlzW2ldO1xufVxuXG5fZXh0ZW5kcyhMaXZlTm9kZUxpc3QsTm9kZUxpc3QpO1xuLyoqXG4gKiBcbiAqIE9iamVjdHMgaW1wbGVtZW50aW5nIHRoZSBOYW1lZE5vZGVNYXAgaW50ZXJmYWNlIGFyZSB1c2VkIHRvIHJlcHJlc2VudCBjb2xsZWN0aW9ucyBvZiBub2RlcyB0aGF0IGNhbiBiZSBhY2Nlc3NlZCBieSBuYW1lLiBOb3RlIHRoYXQgTmFtZWROb2RlTWFwIGRvZXMgbm90IGluaGVyaXQgZnJvbSBOb2RlTGlzdDsgTmFtZWROb2RlTWFwcyBhcmUgbm90IG1haW50YWluZWQgaW4gYW55IHBhcnRpY3VsYXIgb3JkZXIuIE9iamVjdHMgY29udGFpbmVkIGluIGFuIG9iamVjdCBpbXBsZW1lbnRpbmcgTmFtZWROb2RlTWFwIG1heSBhbHNvIGJlIGFjY2Vzc2VkIGJ5IGFuIG9yZGluYWwgaW5kZXgsIGJ1dCB0aGlzIGlzIHNpbXBseSB0byBhbGxvdyBjb252ZW5pZW50IGVudW1lcmF0aW9uIG9mIHRoZSBjb250ZW50cyBvZiBhIE5hbWVkTm9kZU1hcCwgYW5kIGRvZXMgbm90IGltcGx5IHRoYXQgdGhlIERPTSBzcGVjaWZpZXMgYW4gb3JkZXIgdG8gdGhlc2UgTm9kZXMuXG4gKiBOYW1lZE5vZGVNYXAgb2JqZWN0cyBpbiB0aGUgRE9NIGFyZSBsaXZlLlxuICogdXNlZCBmb3IgYXR0cmlidXRlcyBvciBEb2N1bWVudFR5cGUgZW50aXRpZXMgXG4gKi9cbmZ1bmN0aW9uIE5hbWVkTm9kZU1hcCgpIHtcbn07XG5cbmZ1bmN0aW9uIF9maW5kTm9kZUluZGV4KGxpc3Qsbm9kZSl7XG5cdHZhciBpID0gbGlzdC5sZW5ndGg7XG5cdHdoaWxlKGktLSl7XG5cdFx0aWYobGlzdFtpXSA9PT0gbm9kZSl7cmV0dXJuIGl9XG5cdH1cbn1cblxuZnVuY3Rpb24gX2FkZE5hbWVkTm9kZShlbCxsaXN0LG5ld0F0dHIsb2xkQXR0cil7XG5cdGlmKG9sZEF0dHIpe1xuXHRcdGxpc3RbX2ZpbmROb2RlSW5kZXgobGlzdCxvbGRBdHRyKV0gPSBuZXdBdHRyO1xuXHR9ZWxzZXtcblx0XHRsaXN0W2xpc3QubGVuZ3RoKytdID0gbmV3QXR0cjtcblx0fVxuXHRpZihlbCl7XG5cdFx0bmV3QXR0ci5vd25lckVsZW1lbnQgPSBlbDtcblx0XHR2YXIgZG9jID0gZWwub3duZXJEb2N1bWVudDtcblx0XHRpZihkb2Mpe1xuXHRcdFx0b2xkQXR0ciAmJiBfb25SZW1vdmVBdHRyaWJ1dGUoZG9jLGVsLG9sZEF0dHIpO1xuXHRcdFx0X29uQWRkQXR0cmlidXRlKGRvYyxlbCxuZXdBdHRyKTtcblx0XHR9XG5cdH1cbn1cbmZ1bmN0aW9uIF9yZW1vdmVOYW1lZE5vZGUoZWwsbGlzdCxhdHRyKXtcblx0dmFyIGkgPSBfZmluZE5vZGVJbmRleChsaXN0LGF0dHIpO1xuXHRpZihpPj0wKXtcblx0XHR2YXIgbGFzdEluZGV4ID0gbGlzdC5sZW5ndGgtMVxuXHRcdHdoaWxlKGk8bGFzdEluZGV4KXtcblx0XHRcdGxpc3RbaV0gPSBsaXN0WysraV1cblx0XHR9XG5cdFx0bGlzdC5sZW5ndGggPSBsYXN0SW5kZXg7XG5cdFx0aWYoZWwpe1xuXHRcdFx0dmFyIGRvYyA9IGVsLm93bmVyRG9jdW1lbnQ7XG5cdFx0XHRpZihkb2Mpe1xuXHRcdFx0XHRfb25SZW1vdmVBdHRyaWJ1dGUoZG9jLGVsLGF0dHIpO1xuXHRcdFx0XHRhdHRyLm93bmVyRWxlbWVudCA9IG51bGw7XG5cdFx0XHR9XG5cdFx0fVxuXHR9ZWxzZXtcblx0XHR0aHJvdyBET01FeGNlcHRpb24oTk9UX0ZPVU5EX0VSUixuZXcgRXJyb3IoKSlcblx0fVxufVxuTmFtZWROb2RlTWFwLnByb3RvdHlwZSA9IHtcblx0bGVuZ3RoOjAsXG5cdGl0ZW06Tm9kZUxpc3QucHJvdG90eXBlLml0ZW0sXG5cdGdldE5hbWVkSXRlbTogZnVuY3Rpb24oa2V5KSB7XG4vL1x0XHRpZihrZXkuaW5kZXhPZignOicpPjAgfHwga2V5ID09ICd4bWxucycpe1xuLy9cdFx0XHRyZXR1cm4gbnVsbDtcbi8vXHRcdH1cblx0XHR2YXIgaSA9IHRoaXMubGVuZ3RoO1xuXHRcdHdoaWxlKGktLSl7XG5cdFx0XHR2YXIgYXR0ciA9IHRoaXNbaV07XG5cdFx0XHRpZihhdHRyLm5vZGVOYW1lID09IGtleSl7XG5cdFx0XHRcdHJldHVybiBhdHRyO1xuXHRcdFx0fVxuXHRcdH1cblx0fSxcblx0c2V0TmFtZWRJdGVtOiBmdW5jdGlvbihhdHRyKSB7XG5cdFx0dmFyIGVsID0gYXR0ci5vd25lckVsZW1lbnQ7XG5cdFx0aWYoZWwgJiYgZWwhPXRoaXMuX293bmVyRWxlbWVudCl7XG5cdFx0XHR0aHJvdyBuZXcgRE9NRXhjZXB0aW9uKElOVVNFX0FUVFJJQlVURV9FUlIpO1xuXHRcdH1cblx0XHR2YXIgb2xkQXR0ciA9IHRoaXMuZ2V0TmFtZWRJdGVtKGF0dHIubm9kZU5hbWUpO1xuXHRcdF9hZGROYW1lZE5vZGUodGhpcy5fb3duZXJFbGVtZW50LHRoaXMsYXR0cixvbGRBdHRyKTtcblx0XHRyZXR1cm4gb2xkQXR0cjtcblx0fSxcblx0LyogcmV0dXJucyBOb2RlICovXG5cdHNldE5hbWVkSXRlbU5TOiBmdW5jdGlvbihhdHRyKSB7Ly8gcmFpc2VzOiBXUk9OR19ET0NVTUVOVF9FUlIsTk9fTU9ESUZJQ0FUSU9OX0FMTE9XRURfRVJSLElOVVNFX0FUVFJJQlVURV9FUlJcblx0XHR2YXIgZWwgPSBhdHRyLm93bmVyRWxlbWVudCwgb2xkQXR0cjtcblx0XHRpZihlbCAmJiBlbCE9dGhpcy5fb3duZXJFbGVtZW50KXtcblx0XHRcdHRocm93IG5ldyBET01FeGNlcHRpb24oSU5VU0VfQVRUUklCVVRFX0VSUik7XG5cdFx0fVxuXHRcdG9sZEF0dHIgPSB0aGlzLmdldE5hbWVkSXRlbU5TKGF0dHIubmFtZXNwYWNlVVJJLGF0dHIubG9jYWxOYW1lKTtcblx0XHRfYWRkTmFtZWROb2RlKHRoaXMuX293bmVyRWxlbWVudCx0aGlzLGF0dHIsb2xkQXR0cik7XG5cdFx0cmV0dXJuIG9sZEF0dHI7XG5cdH0sXG5cblx0LyogcmV0dXJucyBOb2RlICovXG5cdHJlbW92ZU5hbWVkSXRlbTogZnVuY3Rpb24oa2V5KSB7XG5cdFx0dmFyIGF0dHIgPSB0aGlzLmdldE5hbWVkSXRlbShrZXkpO1xuXHRcdF9yZW1vdmVOYW1lZE5vZGUodGhpcy5fb3duZXJFbGVtZW50LHRoaXMsYXR0cik7XG5cdFx0cmV0dXJuIGF0dHI7XG5cdFx0XG5cdFx0XG5cdH0sLy8gcmFpc2VzOiBOT1RfRk9VTkRfRVJSLE5PX01PRElGSUNBVElPTl9BTExPV0VEX0VSUlxuXHRcblx0Ly9mb3IgbGV2ZWwyXG5cdHJlbW92ZU5hbWVkSXRlbU5TOmZ1bmN0aW9uKG5hbWVzcGFjZVVSSSxsb2NhbE5hbWUpe1xuXHRcdHZhciBhdHRyID0gdGhpcy5nZXROYW1lZEl0ZW1OUyhuYW1lc3BhY2VVUkksbG9jYWxOYW1lKTtcblx0XHRfcmVtb3ZlTmFtZWROb2RlKHRoaXMuX293bmVyRWxlbWVudCx0aGlzLGF0dHIpO1xuXHRcdHJldHVybiBhdHRyO1xuXHR9LFxuXHRnZXROYW1lZEl0ZW1OUzogZnVuY3Rpb24obmFtZXNwYWNlVVJJLCBsb2NhbE5hbWUpIHtcblx0XHR2YXIgaSA9IHRoaXMubGVuZ3RoO1xuXHRcdHdoaWxlKGktLSl7XG5cdFx0XHR2YXIgbm9kZSA9IHRoaXNbaV07XG5cdFx0XHRpZihub2RlLmxvY2FsTmFtZSA9PSBsb2NhbE5hbWUgJiYgbm9kZS5uYW1lc3BhY2VVUkkgPT0gbmFtZXNwYWNlVVJJKXtcblx0XHRcdFx0cmV0dXJuIG5vZGU7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHJldHVybiBudWxsO1xuXHR9XG59O1xuLyoqXG4gKiBAc2VlIGh0dHA6Ly93d3cudzMub3JnL1RSL1JFQy1ET00tTGV2ZWwtMS9sZXZlbC1vbmUtY29yZS5odG1sI0lELTEwMjE2MTQ5MFxuICovXG5mdW5jdGlvbiBET01JbXBsZW1lbnRhdGlvbigvKiBPYmplY3QgKi8gZmVhdHVyZXMpIHtcblx0dGhpcy5fZmVhdHVyZXMgPSB7fTtcblx0aWYgKGZlYXR1cmVzKSB7XG5cdFx0Zm9yICh2YXIgZmVhdHVyZSBpbiBmZWF0dXJlcykge1xuXHRcdFx0IHRoaXMuX2ZlYXR1cmVzID0gZmVhdHVyZXNbZmVhdHVyZV07XG5cdFx0fVxuXHR9XG59O1xuXG5ET01JbXBsZW1lbnRhdGlvbi5wcm90b3R5cGUgPSB7XG5cdGhhc0ZlYXR1cmU6IGZ1bmN0aW9uKC8qIHN0cmluZyAqLyBmZWF0dXJlLCAvKiBzdHJpbmcgKi8gdmVyc2lvbikge1xuXHRcdHZhciB2ZXJzaW9ucyA9IHRoaXMuX2ZlYXR1cmVzW2ZlYXR1cmUudG9Mb3dlckNhc2UoKV07XG5cdFx0aWYgKHZlcnNpb25zICYmICghdmVyc2lvbiB8fCB2ZXJzaW9uIGluIHZlcnNpb25zKSkge1xuXHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0fSBlbHNlIHtcblx0XHRcdHJldHVybiBmYWxzZTtcblx0XHR9XG5cdH0sXG5cdC8vIEludHJvZHVjZWQgaW4gRE9NIExldmVsIDI6XG5cdGNyZWF0ZURvY3VtZW50OmZ1bmN0aW9uKG5hbWVzcGFjZVVSSSwgIHF1YWxpZmllZE5hbWUsIGRvY3R5cGUpey8vIHJhaXNlczpJTlZBTElEX0NIQVJBQ1RFUl9FUlIsTkFNRVNQQUNFX0VSUixXUk9OR19ET0NVTUVOVF9FUlJcblx0XHR2YXIgZG9jID0gbmV3IERvY3VtZW50KCk7XG5cdFx0ZG9jLmRvY3R5cGUgPSBkb2N0eXBlO1xuXHRcdGlmKGRvY3R5cGUpe1xuXHRcdFx0ZG9jLmFwcGVuZENoaWxkKGRvY3R5cGUpO1xuXHRcdH1cblx0XHRkb2MuaW1wbGVtZW50YXRpb24gPSB0aGlzO1xuXHRcdGRvYy5jaGlsZE5vZGVzID0gbmV3IE5vZGVMaXN0KCk7XG5cdFx0aWYocXVhbGlmaWVkTmFtZSl7XG5cdFx0XHR2YXIgcm9vdCA9IGRvYy5jcmVhdGVFbGVtZW50TlMobmFtZXNwYWNlVVJJLHF1YWxpZmllZE5hbWUpO1xuXHRcdFx0ZG9jLmFwcGVuZENoaWxkKHJvb3QpO1xuXHRcdH1cblx0XHRyZXR1cm4gZG9jO1xuXHR9LFxuXHQvLyBJbnRyb2R1Y2VkIGluIERPTSBMZXZlbCAyOlxuXHRjcmVhdGVEb2N1bWVudFR5cGU6ZnVuY3Rpb24ocXVhbGlmaWVkTmFtZSwgcHVibGljSWQsIHN5c3RlbUlkKXsvLyByYWlzZXM6SU5WQUxJRF9DSEFSQUNURVJfRVJSLE5BTUVTUEFDRV9FUlJcblx0XHR2YXIgbm9kZSA9IG5ldyBEb2N1bWVudFR5cGUoKTtcblx0XHRub2RlLm5hbWUgPSBxdWFsaWZpZWROYW1lO1xuXHRcdG5vZGUubm9kZU5hbWUgPSBxdWFsaWZpZWROYW1lO1xuXHRcdG5vZGUucHVibGljSWQgPSBwdWJsaWNJZDtcblx0XHRub2RlLnN5c3RlbUlkID0gc3lzdGVtSWQ7XG5cdFx0Ly8gSW50cm9kdWNlZCBpbiBET00gTGV2ZWwgMjpcblx0XHQvL3JlYWRvbmx5IGF0dHJpYnV0ZSBET01TdHJpbmcgICAgICAgIGludGVybmFsU3Vic2V0O1xuXHRcdFxuXHRcdC8vVE9ETzouLlxuXHRcdC8vICByZWFkb25seSBhdHRyaWJ1dGUgTmFtZWROb2RlTWFwICAgICBlbnRpdGllcztcblx0XHQvLyAgcmVhZG9ubHkgYXR0cmlidXRlIE5hbWVkTm9kZU1hcCAgICAgbm90YXRpb25zO1xuXHRcdHJldHVybiBub2RlO1xuXHR9XG59O1xuXG5cbi8qKlxuICogQHNlZSBodHRwOi8vd3d3LnczLm9yZy9UUi8yMDAwL1JFQy1ET00tTGV2ZWwtMi1Db3JlLTIwMDAxMTEzL2NvcmUuaHRtbCNJRC0xOTUwNjQxMjQ3XG4gKi9cblxuZnVuY3Rpb24gTm9kZSgpIHtcbn07XG5cbk5vZGUucHJvdG90eXBlID0ge1xuXHRmaXJzdENoaWxkIDogbnVsbCxcblx0bGFzdENoaWxkIDogbnVsbCxcblx0cHJldmlvdXNTaWJsaW5nIDogbnVsbCxcblx0bmV4dFNpYmxpbmcgOiBudWxsLFxuXHRhdHRyaWJ1dGVzIDogbnVsbCxcblx0cGFyZW50Tm9kZSA6IG51bGwsXG5cdGNoaWxkTm9kZXMgOiBudWxsLFxuXHRvd25lckRvY3VtZW50IDogbnVsbCxcblx0bm9kZVZhbHVlIDogbnVsbCxcblx0bmFtZXNwYWNlVVJJIDogbnVsbCxcblx0cHJlZml4IDogbnVsbCxcblx0bG9jYWxOYW1lIDogbnVsbCxcblx0Ly8gTW9kaWZpZWQgaW4gRE9NIExldmVsIDI6XG5cdGluc2VydEJlZm9yZTpmdW5jdGlvbihuZXdDaGlsZCwgcmVmQ2hpbGQpey8vcmFpc2VzIFxuXHRcdHJldHVybiBfaW5zZXJ0QmVmb3JlKHRoaXMsbmV3Q2hpbGQscmVmQ2hpbGQpO1xuXHR9LFxuXHRyZXBsYWNlQ2hpbGQ6ZnVuY3Rpb24obmV3Q2hpbGQsIG9sZENoaWxkKXsvL3JhaXNlcyBcblx0XHR0aGlzLmluc2VydEJlZm9yZShuZXdDaGlsZCxvbGRDaGlsZCk7XG5cdFx0aWYob2xkQ2hpbGQpe1xuXHRcdFx0dGhpcy5yZW1vdmVDaGlsZChvbGRDaGlsZCk7XG5cdFx0fVxuXHR9LFxuXHRyZW1vdmVDaGlsZDpmdW5jdGlvbihvbGRDaGlsZCl7XG5cdFx0cmV0dXJuIF9yZW1vdmVDaGlsZCh0aGlzLG9sZENoaWxkKTtcblx0fSxcblx0YXBwZW5kQ2hpbGQ6ZnVuY3Rpb24obmV3Q2hpbGQpe1xuXHRcdHJldHVybiB0aGlzLmluc2VydEJlZm9yZShuZXdDaGlsZCxudWxsKTtcblx0fSxcblx0aGFzQ2hpbGROb2RlczpmdW5jdGlvbigpe1xuXHRcdHJldHVybiB0aGlzLmZpcnN0Q2hpbGQgIT0gbnVsbDtcblx0fSxcblx0Y2xvbmVOb2RlOmZ1bmN0aW9uKGRlZXApe1xuXHRcdHJldHVybiBjbG9uZU5vZGUodGhpcy5vd25lckRvY3VtZW50fHx0aGlzLHRoaXMsZGVlcCk7XG5cdH0sXG5cdC8vIE1vZGlmaWVkIGluIERPTSBMZXZlbCAyOlxuXHRub3JtYWxpemU6ZnVuY3Rpb24oKXtcblx0XHR2YXIgY2hpbGQgPSB0aGlzLmZpcnN0Q2hpbGQ7XG5cdFx0d2hpbGUoY2hpbGQpe1xuXHRcdFx0dmFyIG5leHQgPSBjaGlsZC5uZXh0U2libGluZztcblx0XHRcdGlmKG5leHQgJiYgbmV4dC5ub2RlVHlwZSA9PSBURVhUX05PREUgJiYgY2hpbGQubm9kZVR5cGUgPT0gVEVYVF9OT0RFKXtcblx0XHRcdFx0dGhpcy5yZW1vdmVDaGlsZChuZXh0KTtcblx0XHRcdFx0Y2hpbGQuYXBwZW5kRGF0YShuZXh0LmRhdGEpO1xuXHRcdFx0fWVsc2V7XG5cdFx0XHRcdGNoaWxkLm5vcm1hbGl6ZSgpO1xuXHRcdFx0XHRjaGlsZCA9IG5leHQ7XG5cdFx0XHR9XG5cdFx0fVxuXHR9LFxuICBcdC8vIEludHJvZHVjZWQgaW4gRE9NIExldmVsIDI6XG5cdGlzU3VwcG9ydGVkOmZ1bmN0aW9uKGZlYXR1cmUsIHZlcnNpb24pe1xuXHRcdHJldHVybiB0aGlzLm93bmVyRG9jdW1lbnQuaW1wbGVtZW50YXRpb24uaGFzRmVhdHVyZShmZWF0dXJlLHZlcnNpb24pO1xuXHR9LFxuICAgIC8vIEludHJvZHVjZWQgaW4gRE9NIExldmVsIDI6XG4gICAgaGFzQXR0cmlidXRlczpmdW5jdGlvbigpe1xuICAgIFx0cmV0dXJuIHRoaXMuYXR0cmlidXRlcy5sZW5ndGg+MDtcbiAgICB9LFxuICAgIGxvb2t1cFByZWZpeDpmdW5jdGlvbihuYW1lc3BhY2VVUkkpe1xuICAgIFx0dmFyIGVsID0gdGhpcztcbiAgICBcdHdoaWxlKGVsKXtcbiAgICBcdFx0dmFyIG1hcCA9IGVsLl9uc01hcDtcbiAgICBcdFx0Ly9jb25zb2xlLmRpcihtYXApXG4gICAgXHRcdGlmKG1hcCl7XG4gICAgXHRcdFx0Zm9yKHZhciBuIGluIG1hcCl7XG4gICAgXHRcdFx0XHRpZihtYXBbbl0gPT0gbmFtZXNwYWNlVVJJKXtcbiAgICBcdFx0XHRcdFx0cmV0dXJuIG47XG4gICAgXHRcdFx0XHR9XG4gICAgXHRcdFx0fVxuICAgIFx0XHR9XG4gICAgXHRcdGVsID0gZWwubm9kZVR5cGUgPT0gMj9lbC5vd25lckRvY3VtZW50IDogZWwucGFyZW50Tm9kZTtcbiAgICBcdH1cbiAgICBcdHJldHVybiBudWxsO1xuICAgIH0sXG4gICAgLy8gSW50cm9kdWNlZCBpbiBET00gTGV2ZWwgMzpcbiAgICBsb29rdXBOYW1lc3BhY2VVUkk6ZnVuY3Rpb24ocHJlZml4KXtcbiAgICBcdHZhciBlbCA9IHRoaXM7XG4gICAgXHR3aGlsZShlbCl7XG4gICAgXHRcdHZhciBtYXAgPSBlbC5fbnNNYXA7XG4gICAgXHRcdC8vY29uc29sZS5kaXIobWFwKVxuICAgIFx0XHRpZihtYXApe1xuICAgIFx0XHRcdGlmKHByZWZpeCBpbiBtYXApe1xuICAgIFx0XHRcdFx0cmV0dXJuIG1hcFtwcmVmaXhdIDtcbiAgICBcdFx0XHR9XG4gICAgXHRcdH1cbiAgICBcdFx0ZWwgPSBlbC5ub2RlVHlwZSA9PSAyP2VsLm93bmVyRG9jdW1lbnQgOiBlbC5wYXJlbnROb2RlO1xuICAgIFx0fVxuICAgIFx0cmV0dXJuIG51bGw7XG4gICAgfSxcbiAgICAvLyBJbnRyb2R1Y2VkIGluIERPTSBMZXZlbCAzOlxuICAgIGlzRGVmYXVsdE5hbWVzcGFjZTpmdW5jdGlvbihuYW1lc3BhY2VVUkkpe1xuICAgIFx0dmFyIHByZWZpeCA9IHRoaXMubG9va3VwUHJlZml4KG5hbWVzcGFjZVVSSSk7XG4gICAgXHRyZXR1cm4gcHJlZml4ID09IG51bGw7XG4gICAgfVxufTtcblxuXG5mdW5jdGlvbiBfeG1sRW5jb2RlcihjKXtcblx0cmV0dXJuIGMgPT0gJzwnICYmICcmbHQ7JyB8fFxuICAgICAgICAgYyA9PSAnPicgJiYgJyZndDsnIHx8XG4gICAgICAgICBjID09ICcmJyAmJiAnJmFtcDsnIHx8XG4gICAgICAgICBjID09ICdcIicgJiYgJyZxdW90OycgfHxcbiAgICAgICAgICcmIycrYy5jaGFyQ29kZUF0KCkrJzsnXG59XG5cblxuY29weShOb2RlVHlwZSxOb2RlKTtcbmNvcHkoTm9kZVR5cGUsTm9kZS5wcm90b3R5cGUpO1xuXG4vKipcbiAqIEBwYXJhbSBjYWxsYmFjayByZXR1cm4gdHJ1ZSBmb3IgY29udGludWUsZmFsc2UgZm9yIGJyZWFrXG4gKiBAcmV0dXJuIGJvb2xlYW4gdHJ1ZTogYnJlYWsgdmlzaXQ7XG4gKi9cbmZ1bmN0aW9uIF92aXNpdE5vZGUobm9kZSxjYWxsYmFjayl7XG5cdGlmKGNhbGxiYWNrKG5vZGUpKXtcblx0XHRyZXR1cm4gdHJ1ZTtcblx0fVxuXHRpZihub2RlID0gbm9kZS5maXJzdENoaWxkKXtcblx0XHRkb3tcblx0XHRcdGlmKF92aXNpdE5vZGUobm9kZSxjYWxsYmFjaykpe3JldHVybiB0cnVlfVxuICAgICAgICB9d2hpbGUobm9kZT1ub2RlLm5leHRTaWJsaW5nKVxuICAgIH1cbn1cblxuXG5cbmZ1bmN0aW9uIERvY3VtZW50KCl7XG59XG5mdW5jdGlvbiBfb25BZGRBdHRyaWJ1dGUoZG9jLGVsLG5ld0F0dHIpe1xuXHRkb2MgJiYgZG9jLl9pbmMrKztcblx0dmFyIG5zID0gbmV3QXR0ci5uYW1lc3BhY2VVUkkgO1xuXHRpZihucyA9PSAnaHR0cDovL3d3dy53My5vcmcvMjAwMC94bWxucy8nKXtcblx0XHQvL3VwZGF0ZSBuYW1lc3BhY2Vcblx0XHRlbC5fbnNNYXBbbmV3QXR0ci5wcmVmaXg/bmV3QXR0ci5sb2NhbE5hbWU6JyddID0gbmV3QXR0ci52YWx1ZVxuXHR9XG59XG5mdW5jdGlvbiBfb25SZW1vdmVBdHRyaWJ1dGUoZG9jLGVsLG5ld0F0dHIscmVtb3ZlKXtcblx0ZG9jICYmIGRvYy5faW5jKys7XG5cdHZhciBucyA9IG5ld0F0dHIubmFtZXNwYWNlVVJJIDtcblx0aWYobnMgPT0gJ2h0dHA6Ly93d3cudzMub3JnLzIwMDAveG1sbnMvJyl7XG5cdFx0Ly91cGRhdGUgbmFtZXNwYWNlXG5cdFx0ZGVsZXRlIGVsLl9uc01hcFtuZXdBdHRyLnByZWZpeD9uZXdBdHRyLmxvY2FsTmFtZTonJ11cblx0fVxufVxuZnVuY3Rpb24gX29uVXBkYXRlQ2hpbGQoZG9jLGVsLG5ld0NoaWxkKXtcblx0aWYoZG9jICYmIGRvYy5faW5jKXtcblx0XHRkb2MuX2luYysrO1xuXHRcdC8vdXBkYXRlIGNoaWxkTm9kZXNcblx0XHR2YXIgY3MgPSBlbC5jaGlsZE5vZGVzO1xuXHRcdGlmKG5ld0NoaWxkKXtcblx0XHRcdGNzW2NzLmxlbmd0aCsrXSA9IG5ld0NoaWxkO1xuXHRcdH1lbHNle1xuXHRcdFx0Ly9jb25zb2xlLmxvZygxKVxuXHRcdFx0dmFyIGNoaWxkID0gZWwuZmlyc3RDaGlsZDtcblx0XHRcdHZhciBpID0gMDtcblx0XHRcdHdoaWxlKGNoaWxkKXtcblx0XHRcdFx0Y3NbaSsrXSA9IGNoaWxkO1xuXHRcdFx0XHRjaGlsZCA9Y2hpbGQubmV4dFNpYmxpbmc7XG5cdFx0XHR9XG5cdFx0XHRjcy5sZW5ndGggPSBpO1xuXHRcdH1cblx0fVxufVxuXG4vKipcbiAqIGF0dHJpYnV0ZXM7XG4gKiBjaGlsZHJlbjtcbiAqIFxuICogd3JpdGVhYmxlIHByb3BlcnRpZXM6XG4gKiBub2RlVmFsdWUsQXR0cjp2YWx1ZSxDaGFyYWN0ZXJEYXRhOmRhdGFcbiAqIHByZWZpeFxuICovXG5mdW5jdGlvbiBfcmVtb3ZlQ2hpbGQocGFyZW50Tm9kZSxjaGlsZCl7XG5cdHZhciBwcmV2aW91cyA9IGNoaWxkLnByZXZpb3VzU2libGluZztcblx0dmFyIG5leHQgPSBjaGlsZC5uZXh0U2libGluZztcblx0aWYocHJldmlvdXMpe1xuXHRcdHByZXZpb3VzLm5leHRTaWJsaW5nID0gbmV4dDtcblx0fWVsc2V7XG5cdFx0cGFyZW50Tm9kZS5maXJzdENoaWxkID0gbmV4dFxuXHR9XG5cdGlmKG5leHQpe1xuXHRcdG5leHQucHJldmlvdXNTaWJsaW5nID0gcHJldmlvdXM7XG5cdH1lbHNle1xuXHRcdHBhcmVudE5vZGUubGFzdENoaWxkID0gcHJldmlvdXM7XG5cdH1cblx0X29uVXBkYXRlQ2hpbGQocGFyZW50Tm9kZS5vd25lckRvY3VtZW50LHBhcmVudE5vZGUpO1xuXHRyZXR1cm4gY2hpbGQ7XG59XG4vKipcbiAqIHByZWZvcm1hbmNlIGtleShyZWZDaGlsZCA9PSBudWxsKVxuICovXG5mdW5jdGlvbiBfaW5zZXJ0QmVmb3JlKHBhcmVudE5vZGUsbmV3Q2hpbGQsbmV4dENoaWxkKXtcblx0dmFyIGNwID0gbmV3Q2hpbGQucGFyZW50Tm9kZTtcblx0aWYoY3Ape1xuXHRcdGNwLnJlbW92ZUNoaWxkKG5ld0NoaWxkKTsvL3JlbW92ZSBhbmQgdXBkYXRlXG5cdH1cblx0aWYobmV3Q2hpbGQubm9kZVR5cGUgPT09IERPQ1VNRU5UX0ZSQUdNRU5UX05PREUpe1xuXHRcdHZhciBuZXdGaXJzdCA9IG5ld0NoaWxkLmZpcnN0Q2hpbGQ7XG5cdFx0aWYgKG5ld0ZpcnN0ID09IG51bGwpIHtcblx0XHRcdHJldHVybiBuZXdDaGlsZDtcblx0XHR9XG5cdFx0dmFyIG5ld0xhc3QgPSBuZXdDaGlsZC5sYXN0Q2hpbGQ7XG5cdH1lbHNle1xuXHRcdG5ld0ZpcnN0ID0gbmV3TGFzdCA9IG5ld0NoaWxkO1xuXHR9XG5cdHZhciBwcmUgPSBuZXh0Q2hpbGQgPyBuZXh0Q2hpbGQucHJldmlvdXNTaWJsaW5nIDogcGFyZW50Tm9kZS5sYXN0Q2hpbGQ7XG5cblx0bmV3Rmlyc3QucHJldmlvdXNTaWJsaW5nID0gcHJlO1xuXHRuZXdMYXN0Lm5leHRTaWJsaW5nID0gbmV4dENoaWxkO1xuXHRcblx0XG5cdGlmKHByZSl7XG5cdFx0cHJlLm5leHRTaWJsaW5nID0gbmV3Rmlyc3Q7XG5cdH1lbHNle1xuXHRcdHBhcmVudE5vZGUuZmlyc3RDaGlsZCA9IG5ld0ZpcnN0O1xuXHR9XG5cdGlmKG5leHRDaGlsZCA9PSBudWxsKXtcblx0XHRwYXJlbnROb2RlLmxhc3RDaGlsZCA9IG5ld0xhc3Q7XG5cdH1lbHNle1xuXHRcdG5leHRDaGlsZC5wcmV2aW91c1NpYmxpbmcgPSBuZXdMYXN0O1xuXHR9XG5cdGRve1xuXHRcdG5ld0ZpcnN0LnBhcmVudE5vZGUgPSBwYXJlbnROb2RlO1xuXHR9d2hpbGUobmV3Rmlyc3QgIT09IG5ld0xhc3QgJiYgKG5ld0ZpcnN0PSBuZXdGaXJzdC5uZXh0U2libGluZykpXG5cdF9vblVwZGF0ZUNoaWxkKHBhcmVudE5vZGUub3duZXJEb2N1bWVudHx8cGFyZW50Tm9kZSxwYXJlbnROb2RlKTtcblx0Ly9jb25zb2xlLmxvZyhwYXJlbnROb2RlLmxhc3RDaGlsZC5uZXh0U2libGluZyA9PSBudWxsKVxuXHRpZiAobmV3Q2hpbGQubm9kZVR5cGUgPT0gRE9DVU1FTlRfRlJBR01FTlRfTk9ERSkge1xuXHRcdG5ld0NoaWxkLmZpcnN0Q2hpbGQgPSBuZXdDaGlsZC5sYXN0Q2hpbGQgPSBudWxsO1xuXHR9XG5cdHJldHVybiBuZXdDaGlsZDtcbn1cbmZ1bmN0aW9uIF9hcHBlbmRTaW5nbGVDaGlsZChwYXJlbnROb2RlLG5ld0NoaWxkKXtcblx0dmFyIGNwID0gbmV3Q2hpbGQucGFyZW50Tm9kZTtcblx0aWYoY3Ape1xuXHRcdHZhciBwcmUgPSBwYXJlbnROb2RlLmxhc3RDaGlsZDtcblx0XHRjcC5yZW1vdmVDaGlsZChuZXdDaGlsZCk7Ly9yZW1vdmUgYW5kIHVwZGF0ZVxuXHRcdHZhciBwcmUgPSBwYXJlbnROb2RlLmxhc3RDaGlsZDtcblx0fVxuXHR2YXIgcHJlID0gcGFyZW50Tm9kZS5sYXN0Q2hpbGQ7XG5cdG5ld0NoaWxkLnBhcmVudE5vZGUgPSBwYXJlbnROb2RlO1xuXHRuZXdDaGlsZC5wcmV2aW91c1NpYmxpbmcgPSBwcmU7XG5cdG5ld0NoaWxkLm5leHRTaWJsaW5nID0gbnVsbDtcblx0aWYocHJlKXtcblx0XHRwcmUubmV4dFNpYmxpbmcgPSBuZXdDaGlsZDtcblx0fWVsc2V7XG5cdFx0cGFyZW50Tm9kZS5maXJzdENoaWxkID0gbmV3Q2hpbGQ7XG5cdH1cblx0cGFyZW50Tm9kZS5sYXN0Q2hpbGQgPSBuZXdDaGlsZDtcblx0X29uVXBkYXRlQ2hpbGQocGFyZW50Tm9kZS5vd25lckRvY3VtZW50LHBhcmVudE5vZGUsbmV3Q2hpbGQpO1xuXHRyZXR1cm4gbmV3Q2hpbGQ7XG5cdC8vY29uc29sZS5sb2coXCJfX2FhXCIscGFyZW50Tm9kZS5sYXN0Q2hpbGQubmV4dFNpYmxpbmcgPT0gbnVsbClcbn1cbkRvY3VtZW50LnByb3RvdHlwZSA9IHtcblx0Ly9pbXBsZW1lbnRhdGlvbiA6IG51bGwsXG5cdG5vZGVOYW1lIDogICcjZG9jdW1lbnQnLFxuXHRub2RlVHlwZSA6ICBET0NVTUVOVF9OT0RFLFxuXHRkb2N0eXBlIDogIG51bGwsXG5cdGRvY3VtZW50RWxlbWVudCA6ICBudWxsLFxuXHRfaW5jIDogMSxcblx0XG5cdGluc2VydEJlZm9yZSA6ICBmdW5jdGlvbihuZXdDaGlsZCwgcmVmQ2hpbGQpey8vcmFpc2VzIFxuXHRcdGlmKG5ld0NoaWxkLm5vZGVUeXBlID09IERPQ1VNRU5UX0ZSQUdNRU5UX05PREUpe1xuXHRcdFx0dmFyIGNoaWxkID0gbmV3Q2hpbGQuZmlyc3RDaGlsZDtcblx0XHRcdHdoaWxlKGNoaWxkKXtcblx0XHRcdFx0dmFyIG5leHQgPSBjaGlsZC5uZXh0U2libGluZztcblx0XHRcdFx0dGhpcy5pbnNlcnRCZWZvcmUoY2hpbGQscmVmQ2hpbGQpO1xuXHRcdFx0XHRjaGlsZCA9IG5leHQ7XG5cdFx0XHR9XG5cdFx0XHRyZXR1cm4gbmV3Q2hpbGQ7XG5cdFx0fVxuXHRcdGlmKHRoaXMuZG9jdW1lbnRFbGVtZW50ID09IG51bGwgJiYgbmV3Q2hpbGQubm9kZVR5cGUgPT0gMSl7XG5cdFx0XHR0aGlzLmRvY3VtZW50RWxlbWVudCA9IG5ld0NoaWxkO1xuXHRcdH1cblx0XHRcblx0XHRyZXR1cm4gX2luc2VydEJlZm9yZSh0aGlzLG5ld0NoaWxkLHJlZkNoaWxkKSwobmV3Q2hpbGQub3duZXJEb2N1bWVudCA9IHRoaXMpLG5ld0NoaWxkO1xuXHR9LFxuXHRyZW1vdmVDaGlsZCA6ICBmdW5jdGlvbihvbGRDaGlsZCl7XG5cdFx0aWYodGhpcy5kb2N1bWVudEVsZW1lbnQgPT0gb2xkQ2hpbGQpe1xuXHRcdFx0dGhpcy5kb2N1bWVudEVsZW1lbnQgPSBudWxsO1xuXHRcdH1cblx0XHRyZXR1cm4gX3JlbW92ZUNoaWxkKHRoaXMsb2xkQ2hpbGQpO1xuXHR9LFxuXHQvLyBJbnRyb2R1Y2VkIGluIERPTSBMZXZlbCAyOlxuXHRpbXBvcnROb2RlIDogZnVuY3Rpb24oaW1wb3J0ZWROb2RlLGRlZXApe1xuXHRcdHJldHVybiBpbXBvcnROb2RlKHRoaXMsaW1wb3J0ZWROb2RlLGRlZXApO1xuXHR9LFxuXHQvLyBJbnRyb2R1Y2VkIGluIERPTSBMZXZlbCAyOlxuXHRnZXRFbGVtZW50QnlJZCA6XHRmdW5jdGlvbihpZCl7XG5cdFx0dmFyIHJ0diA9IG51bGw7XG5cdFx0X3Zpc2l0Tm9kZSh0aGlzLmRvY3VtZW50RWxlbWVudCxmdW5jdGlvbihub2RlKXtcblx0XHRcdGlmKG5vZGUubm9kZVR5cGUgPT0gMSl7XG5cdFx0XHRcdGlmKG5vZGUuZ2V0QXR0cmlidXRlKCdpZCcpID09IGlkKXtcblx0XHRcdFx0XHRydHYgPSBub2RlO1xuXHRcdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fSlcblx0XHRyZXR1cm4gcnR2O1xuXHR9LFxuXHRcblx0Ly9kb2N1bWVudCBmYWN0b3J5IG1ldGhvZDpcblx0Y3JlYXRlRWxlbWVudCA6XHRmdW5jdGlvbih0YWdOYW1lKXtcblx0XHR2YXIgbm9kZSA9IG5ldyBFbGVtZW50KCk7XG5cdFx0bm9kZS5vd25lckRvY3VtZW50ID0gdGhpcztcblx0XHRub2RlLm5vZGVOYW1lID0gdGFnTmFtZTtcblx0XHRub2RlLnRhZ05hbWUgPSB0YWdOYW1lO1xuXHRcdG5vZGUuY2hpbGROb2RlcyA9IG5ldyBOb2RlTGlzdCgpO1xuXHRcdHZhciBhdHRyc1x0PSBub2RlLmF0dHJpYnV0ZXMgPSBuZXcgTmFtZWROb2RlTWFwKCk7XG5cdFx0YXR0cnMuX293bmVyRWxlbWVudCA9IG5vZGU7XG5cdFx0cmV0dXJuIG5vZGU7XG5cdH0sXG5cdGNyZWF0ZURvY3VtZW50RnJhZ21lbnQgOlx0ZnVuY3Rpb24oKXtcblx0XHR2YXIgbm9kZSA9IG5ldyBEb2N1bWVudEZyYWdtZW50KCk7XG5cdFx0bm9kZS5vd25lckRvY3VtZW50ID0gdGhpcztcblx0XHRub2RlLmNoaWxkTm9kZXMgPSBuZXcgTm9kZUxpc3QoKTtcblx0XHRyZXR1cm4gbm9kZTtcblx0fSxcblx0Y3JlYXRlVGV4dE5vZGUgOlx0ZnVuY3Rpb24oZGF0YSl7XG5cdFx0dmFyIG5vZGUgPSBuZXcgVGV4dCgpO1xuXHRcdG5vZGUub3duZXJEb2N1bWVudCA9IHRoaXM7XG5cdFx0bm9kZS5hcHBlbmREYXRhKGRhdGEpXG5cdFx0cmV0dXJuIG5vZGU7XG5cdH0sXG5cdGNyZWF0ZUNvbW1lbnQgOlx0ZnVuY3Rpb24oZGF0YSl7XG5cdFx0dmFyIG5vZGUgPSBuZXcgQ29tbWVudCgpO1xuXHRcdG5vZGUub3duZXJEb2N1bWVudCA9IHRoaXM7XG5cdFx0bm9kZS5hcHBlbmREYXRhKGRhdGEpXG5cdFx0cmV0dXJuIG5vZGU7XG5cdH0sXG5cdGNyZWF0ZUNEQVRBU2VjdGlvbiA6XHRmdW5jdGlvbihkYXRhKXtcblx0XHR2YXIgbm9kZSA9IG5ldyBDREFUQVNlY3Rpb24oKTtcblx0XHRub2RlLm93bmVyRG9jdW1lbnQgPSB0aGlzO1xuXHRcdG5vZGUuYXBwZW5kRGF0YShkYXRhKVxuXHRcdHJldHVybiBub2RlO1xuXHR9LFxuXHRjcmVhdGVQcm9jZXNzaW5nSW5zdHJ1Y3Rpb24gOlx0ZnVuY3Rpb24odGFyZ2V0LGRhdGEpe1xuXHRcdHZhciBub2RlID0gbmV3IFByb2Nlc3NpbmdJbnN0cnVjdGlvbigpO1xuXHRcdG5vZGUub3duZXJEb2N1bWVudCA9IHRoaXM7XG5cdFx0bm9kZS50YWdOYW1lID0gbm9kZS50YXJnZXQgPSB0YXJnZXQ7XG5cdFx0bm9kZS5ub2RlVmFsdWU9IG5vZGUuZGF0YSA9IGRhdGE7XG5cdFx0cmV0dXJuIG5vZGU7XG5cdH0sXG5cdGNyZWF0ZUF0dHJpYnV0ZSA6XHRmdW5jdGlvbihuYW1lKXtcblx0XHR2YXIgbm9kZSA9IG5ldyBBdHRyKCk7XG5cdFx0bm9kZS5vd25lckRvY3VtZW50XHQ9IHRoaXM7XG5cdFx0bm9kZS5uYW1lID0gbmFtZTtcblx0XHRub2RlLm5vZGVOYW1lXHQ9IG5hbWU7XG5cdFx0bm9kZS5sb2NhbE5hbWUgPSBuYW1lO1xuXHRcdG5vZGUuc3BlY2lmaWVkID0gdHJ1ZTtcblx0XHRyZXR1cm4gbm9kZTtcblx0fSxcblx0Y3JlYXRlRW50aXR5UmVmZXJlbmNlIDpcdGZ1bmN0aW9uKG5hbWUpe1xuXHRcdHZhciBub2RlID0gbmV3IEVudGl0eVJlZmVyZW5jZSgpO1xuXHRcdG5vZGUub3duZXJEb2N1bWVudFx0PSB0aGlzO1xuXHRcdG5vZGUubm9kZU5hbWVcdD0gbmFtZTtcblx0XHRyZXR1cm4gbm9kZTtcblx0fSxcblx0Ly8gSW50cm9kdWNlZCBpbiBET00gTGV2ZWwgMjpcblx0Y3JlYXRlRWxlbWVudE5TIDpcdGZ1bmN0aW9uKG5hbWVzcGFjZVVSSSxxdWFsaWZpZWROYW1lKXtcblx0XHR2YXIgbm9kZSA9IG5ldyBFbGVtZW50KCk7XG5cdFx0dmFyIHBsID0gcXVhbGlmaWVkTmFtZS5zcGxpdCgnOicpO1xuXHRcdHZhciBhdHRyc1x0PSBub2RlLmF0dHJpYnV0ZXMgPSBuZXcgTmFtZWROb2RlTWFwKCk7XG5cdFx0bm9kZS5jaGlsZE5vZGVzID0gbmV3IE5vZGVMaXN0KCk7XG5cdFx0bm9kZS5vd25lckRvY3VtZW50ID0gdGhpcztcblx0XHRub2RlLm5vZGVOYW1lID0gcXVhbGlmaWVkTmFtZTtcblx0XHRub2RlLnRhZ05hbWUgPSBxdWFsaWZpZWROYW1lO1xuXHRcdG5vZGUubmFtZXNwYWNlVVJJID0gbmFtZXNwYWNlVVJJO1xuXHRcdGlmKHBsLmxlbmd0aCA9PSAyKXtcblx0XHRcdG5vZGUucHJlZml4ID0gcGxbMF07XG5cdFx0XHRub2RlLmxvY2FsTmFtZSA9IHBsWzFdO1xuXHRcdH1lbHNle1xuXHRcdFx0Ly9lbC5wcmVmaXggPSBudWxsO1xuXHRcdFx0bm9kZS5sb2NhbE5hbWUgPSBxdWFsaWZpZWROYW1lO1xuXHRcdH1cblx0XHRhdHRycy5fb3duZXJFbGVtZW50ID0gbm9kZTtcblx0XHRyZXR1cm4gbm9kZTtcblx0fSxcblx0Ly8gSW50cm9kdWNlZCBpbiBET00gTGV2ZWwgMjpcblx0Y3JlYXRlQXR0cmlidXRlTlMgOlx0ZnVuY3Rpb24obmFtZXNwYWNlVVJJLHF1YWxpZmllZE5hbWUpe1xuXHRcdHZhciBub2RlID0gbmV3IEF0dHIoKTtcblx0XHR2YXIgcGwgPSBxdWFsaWZpZWROYW1lLnNwbGl0KCc6Jyk7XG5cdFx0bm9kZS5vd25lckRvY3VtZW50ID0gdGhpcztcblx0XHRub2RlLm5vZGVOYW1lID0gcXVhbGlmaWVkTmFtZTtcblx0XHRub2RlLm5hbWUgPSBxdWFsaWZpZWROYW1lO1xuXHRcdG5vZGUubmFtZXNwYWNlVVJJID0gbmFtZXNwYWNlVVJJO1xuXHRcdG5vZGUuc3BlY2lmaWVkID0gdHJ1ZTtcblx0XHRpZihwbC5sZW5ndGggPT0gMil7XG5cdFx0XHRub2RlLnByZWZpeCA9IHBsWzBdO1xuXHRcdFx0bm9kZS5sb2NhbE5hbWUgPSBwbFsxXTtcblx0XHR9ZWxzZXtcblx0XHRcdC8vZWwucHJlZml4ID0gbnVsbDtcblx0XHRcdG5vZGUubG9jYWxOYW1lID0gcXVhbGlmaWVkTmFtZTtcblx0XHR9XG5cdFx0cmV0dXJuIG5vZGU7XG5cdH1cbn07XG5fZXh0ZW5kcyhEb2N1bWVudCxOb2RlKTtcblxuXG5mdW5jdGlvbiBFbGVtZW50KCkge1xuXHR0aGlzLl9uc01hcCA9IHt9O1xufTtcbkVsZW1lbnQucHJvdG90eXBlID0ge1xuXHRub2RlVHlwZSA6IEVMRU1FTlRfTk9ERSxcblx0aGFzQXR0cmlidXRlIDogZnVuY3Rpb24obmFtZSl7XG5cdFx0cmV0dXJuIHRoaXMuZ2V0QXR0cmlidXRlTm9kZShuYW1lKSE9bnVsbDtcblx0fSxcblx0Z2V0QXR0cmlidXRlIDogZnVuY3Rpb24obmFtZSl7XG5cdFx0dmFyIGF0dHIgPSB0aGlzLmdldEF0dHJpYnV0ZU5vZGUobmFtZSk7XG5cdFx0cmV0dXJuIGF0dHIgJiYgYXR0ci52YWx1ZSB8fCAnJztcblx0fSxcblx0Z2V0QXR0cmlidXRlTm9kZSA6IGZ1bmN0aW9uKG5hbWUpe1xuXHRcdHJldHVybiB0aGlzLmF0dHJpYnV0ZXMuZ2V0TmFtZWRJdGVtKG5hbWUpO1xuXHR9LFxuXHRzZXRBdHRyaWJ1dGUgOiBmdW5jdGlvbihuYW1lLCB2YWx1ZSl7XG5cdFx0dmFyIGF0dHIgPSB0aGlzLm93bmVyRG9jdW1lbnQuY3JlYXRlQXR0cmlidXRlKG5hbWUpO1xuXHRcdGF0dHIudmFsdWUgPSBhdHRyLm5vZGVWYWx1ZSA9IFwiXCIgKyB2YWx1ZTtcblx0XHR0aGlzLnNldEF0dHJpYnV0ZU5vZGUoYXR0cilcblx0fSxcblx0cmVtb3ZlQXR0cmlidXRlIDogZnVuY3Rpb24obmFtZSl7XG5cdFx0dmFyIGF0dHIgPSB0aGlzLmdldEF0dHJpYnV0ZU5vZGUobmFtZSlcblx0XHRhdHRyICYmIHRoaXMucmVtb3ZlQXR0cmlidXRlTm9kZShhdHRyKTtcblx0fSxcblx0XG5cdC8vZm91ciByZWFsIG9wZWFydGlvbiBtZXRob2Rcblx0YXBwZW5kQ2hpbGQ6ZnVuY3Rpb24obmV3Q2hpbGQpe1xuXHRcdGlmKG5ld0NoaWxkLm5vZGVUeXBlID09PSBET0NVTUVOVF9GUkFHTUVOVF9OT0RFKXtcblx0XHRcdHJldHVybiB0aGlzLmluc2VydEJlZm9yZShuZXdDaGlsZCxudWxsKTtcblx0XHR9ZWxzZXtcblx0XHRcdHJldHVybiBfYXBwZW5kU2luZ2xlQ2hpbGQodGhpcyxuZXdDaGlsZCk7XG5cdFx0fVxuXHR9LFxuXHRzZXRBdHRyaWJ1dGVOb2RlIDogZnVuY3Rpb24obmV3QXR0cil7XG5cdFx0cmV0dXJuIHRoaXMuYXR0cmlidXRlcy5zZXROYW1lZEl0ZW0obmV3QXR0cik7XG5cdH0sXG5cdHNldEF0dHJpYnV0ZU5vZGVOUyA6IGZ1bmN0aW9uKG5ld0F0dHIpe1xuXHRcdHJldHVybiB0aGlzLmF0dHJpYnV0ZXMuc2V0TmFtZWRJdGVtTlMobmV3QXR0cik7XG5cdH0sXG5cdHJlbW92ZUF0dHJpYnV0ZU5vZGUgOiBmdW5jdGlvbihvbGRBdHRyKXtcblx0XHRyZXR1cm4gdGhpcy5hdHRyaWJ1dGVzLnJlbW92ZU5hbWVkSXRlbShvbGRBdHRyLm5vZGVOYW1lKTtcblx0fSxcblx0Ly9nZXQgcmVhbCBhdHRyaWJ1dGUgbmFtZSxhbmQgcmVtb3ZlIGl0IGJ5IHJlbW92ZUF0dHJpYnV0ZU5vZGVcblx0cmVtb3ZlQXR0cmlidXRlTlMgOiBmdW5jdGlvbihuYW1lc3BhY2VVUkksIGxvY2FsTmFtZSl7XG5cdFx0dmFyIG9sZCA9IHRoaXMuZ2V0QXR0cmlidXRlTm9kZU5TKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lKTtcblx0XHRvbGQgJiYgdGhpcy5yZW1vdmVBdHRyaWJ1dGVOb2RlKG9sZCk7XG5cdH0sXG5cdFxuXHRoYXNBdHRyaWJ1dGVOUyA6IGZ1bmN0aW9uKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lKXtcblx0XHRyZXR1cm4gdGhpcy5nZXRBdHRyaWJ1dGVOb2RlTlMobmFtZXNwYWNlVVJJLCBsb2NhbE5hbWUpIT1udWxsO1xuXHR9LFxuXHRnZXRBdHRyaWJ1dGVOUyA6IGZ1bmN0aW9uKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lKXtcblx0XHR2YXIgYXR0ciA9IHRoaXMuZ2V0QXR0cmlidXRlTm9kZU5TKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lKTtcblx0XHRyZXR1cm4gYXR0ciAmJiBhdHRyLnZhbHVlIHx8ICcnO1xuXHR9LFxuXHRzZXRBdHRyaWJ1dGVOUyA6IGZ1bmN0aW9uKG5hbWVzcGFjZVVSSSwgcXVhbGlmaWVkTmFtZSwgdmFsdWUpe1xuXHRcdHZhciBhdHRyID0gdGhpcy5vd25lckRvY3VtZW50LmNyZWF0ZUF0dHJpYnV0ZU5TKG5hbWVzcGFjZVVSSSwgcXVhbGlmaWVkTmFtZSk7XG5cdFx0YXR0ci52YWx1ZSA9IGF0dHIubm9kZVZhbHVlID0gdmFsdWU7XG5cdFx0dGhpcy5zZXRBdHRyaWJ1dGVOb2RlKGF0dHIpXG5cdH0sXG5cdGdldEF0dHJpYnV0ZU5vZGVOUyA6IGZ1bmN0aW9uKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lKXtcblx0XHRyZXR1cm4gdGhpcy5hdHRyaWJ1dGVzLmdldE5hbWVkSXRlbU5TKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lKTtcblx0fSxcblx0XG5cdGdldEVsZW1lbnRzQnlUYWdOYW1lIDogZnVuY3Rpb24odGFnTmFtZSl7XG5cdFx0cmV0dXJuIG5ldyBMaXZlTm9kZUxpc3QodGhpcyxmdW5jdGlvbihiYXNlKXtcblx0XHRcdHZhciBscyA9IFtdO1xuXHRcdFx0X3Zpc2l0Tm9kZShiYXNlLGZ1bmN0aW9uKG5vZGUpe1xuXHRcdFx0XHRpZihub2RlICE9PSBiYXNlICYmIG5vZGUubm9kZVR5cGUgPT0gRUxFTUVOVF9OT0RFICYmICh0YWdOYW1lID09PSAnKicgfHwgbm9kZS50YWdOYW1lID09IHRhZ05hbWUpKXtcblx0XHRcdFx0XHRscy5wdXNoKG5vZGUpO1xuXHRcdFx0XHR9XG5cdFx0XHR9KTtcblx0XHRcdHJldHVybiBscztcblx0XHR9KTtcblx0fSxcblx0Z2V0RWxlbWVudHNCeVRhZ05hbWVOUyA6IGZ1bmN0aW9uKG5hbWVzcGFjZVVSSSwgbG9jYWxOYW1lKXtcblx0XHRyZXR1cm4gbmV3IExpdmVOb2RlTGlzdCh0aGlzLGZ1bmN0aW9uKGJhc2Upe1xuXHRcdFx0dmFyIGxzID0gW107XG5cdFx0XHRfdmlzaXROb2RlKGJhc2UsZnVuY3Rpb24obm9kZSl7XG5cdFx0XHRcdGlmKG5vZGUgIT09IGJhc2UgJiYgbm9kZS5ub2RlVHlwZSA9PT0gRUxFTUVOVF9OT0RFICYmIG5vZGUubmFtZXNwYWNlVVJJID09PSBuYW1lc3BhY2VVUkkgJiYgKGxvY2FsTmFtZSA9PT0gJyonIHx8IG5vZGUubG9jYWxOYW1lID09IGxvY2FsTmFtZSkpe1xuXHRcdFx0XHRcdGxzLnB1c2gobm9kZSk7XG5cdFx0XHRcdH1cblx0XHRcdH0pO1xuXHRcdFx0cmV0dXJuIGxzO1xuXHRcdH0pO1xuXHR9XG59O1xuRG9jdW1lbnQucHJvdG90eXBlLmdldEVsZW1lbnRzQnlUYWdOYW1lID0gRWxlbWVudC5wcm90b3R5cGUuZ2V0RWxlbWVudHNCeVRhZ05hbWU7XG5Eb2N1bWVudC5wcm90b3R5cGUuZ2V0RWxlbWVudHNCeVRhZ05hbWVOUyA9IEVsZW1lbnQucHJvdG90eXBlLmdldEVsZW1lbnRzQnlUYWdOYW1lTlM7XG5cblxuX2V4dGVuZHMoRWxlbWVudCxOb2RlKTtcbmZ1bmN0aW9uIEF0dHIoKSB7XG59O1xuQXR0ci5wcm90b3R5cGUubm9kZVR5cGUgPSBBVFRSSUJVVEVfTk9ERTtcbl9leHRlbmRzKEF0dHIsTm9kZSk7XG5cblxuZnVuY3Rpb24gQ2hhcmFjdGVyRGF0YSgpIHtcbn07XG5DaGFyYWN0ZXJEYXRhLnByb3RvdHlwZSA9IHtcblx0ZGF0YSA6ICcnLFxuXHRzdWJzdHJpbmdEYXRhIDogZnVuY3Rpb24ob2Zmc2V0LCBjb3VudCkge1xuXHRcdHJldHVybiB0aGlzLmRhdGEuc3Vic3RyaW5nKG9mZnNldCwgb2Zmc2V0K2NvdW50KTtcblx0fSxcblx0YXBwZW5kRGF0YTogZnVuY3Rpb24odGV4dCkge1xuXHRcdHRleHQgPSB0aGlzLmRhdGErdGV4dDtcblx0XHR0aGlzLm5vZGVWYWx1ZSA9IHRoaXMuZGF0YSA9IHRleHQ7XG5cdFx0dGhpcy5sZW5ndGggPSB0ZXh0Lmxlbmd0aDtcblx0fSxcblx0aW5zZXJ0RGF0YTogZnVuY3Rpb24ob2Zmc2V0LHRleHQpIHtcblx0XHR0aGlzLnJlcGxhY2VEYXRhKG9mZnNldCwwLHRleHQpO1xuXHRcblx0fSxcblx0YXBwZW5kQ2hpbGQ6ZnVuY3Rpb24obmV3Q2hpbGQpe1xuXHRcdC8vaWYoIShuZXdDaGlsZCBpbnN0YW5jZW9mIENoYXJhY3RlckRhdGEpKXtcblx0XHRcdHRocm93IG5ldyBFcnJvcihFeGNlcHRpb25NZXNzYWdlWzNdKVxuXHRcdC8vfVxuXHRcdHJldHVybiBOb2RlLnByb3RvdHlwZS5hcHBlbmRDaGlsZC5hcHBseSh0aGlzLGFyZ3VtZW50cylcblx0fSxcblx0ZGVsZXRlRGF0YTogZnVuY3Rpb24ob2Zmc2V0LCBjb3VudCkge1xuXHRcdHRoaXMucmVwbGFjZURhdGEob2Zmc2V0LGNvdW50LFwiXCIpO1xuXHR9LFxuXHRyZXBsYWNlRGF0YTogZnVuY3Rpb24ob2Zmc2V0LCBjb3VudCwgdGV4dCkge1xuXHRcdHZhciBzdGFydCA9IHRoaXMuZGF0YS5zdWJzdHJpbmcoMCxvZmZzZXQpO1xuXHRcdHZhciBlbmQgPSB0aGlzLmRhdGEuc3Vic3RyaW5nKG9mZnNldCtjb3VudCk7XG5cdFx0dGV4dCA9IHN0YXJ0ICsgdGV4dCArIGVuZDtcblx0XHR0aGlzLm5vZGVWYWx1ZSA9IHRoaXMuZGF0YSA9IHRleHQ7XG5cdFx0dGhpcy5sZW5ndGggPSB0ZXh0Lmxlbmd0aDtcblx0fVxufVxuX2V4dGVuZHMoQ2hhcmFjdGVyRGF0YSxOb2RlKTtcbmZ1bmN0aW9uIFRleHQoKSB7XG59O1xuVGV4dC5wcm90b3R5cGUgPSB7XG5cdG5vZGVOYW1lIDogXCIjdGV4dFwiLFxuXHRub2RlVHlwZSA6IFRFWFRfTk9ERSxcblx0c3BsaXRUZXh0IDogZnVuY3Rpb24ob2Zmc2V0KSB7XG5cdFx0dmFyIHRleHQgPSB0aGlzLmRhdGE7XG5cdFx0dmFyIG5ld1RleHQgPSB0ZXh0LnN1YnN0cmluZyhvZmZzZXQpO1xuXHRcdHRleHQgPSB0ZXh0LnN1YnN0cmluZygwLCBvZmZzZXQpO1xuXHRcdHRoaXMuZGF0YSA9IHRoaXMubm9kZVZhbHVlID0gdGV4dDtcblx0XHR0aGlzLmxlbmd0aCA9IHRleHQubGVuZ3RoO1xuXHRcdHZhciBuZXdOb2RlID0gdGhpcy5vd25lckRvY3VtZW50LmNyZWF0ZVRleHROb2RlKG5ld1RleHQpO1xuXHRcdGlmKHRoaXMucGFyZW50Tm9kZSl7XG5cdFx0XHR0aGlzLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKG5ld05vZGUsIHRoaXMubmV4dFNpYmxpbmcpO1xuXHRcdH1cblx0XHRyZXR1cm4gbmV3Tm9kZTtcblx0fVxufVxuX2V4dGVuZHMoVGV4dCxDaGFyYWN0ZXJEYXRhKTtcbmZ1bmN0aW9uIENvbW1lbnQoKSB7XG59O1xuQ29tbWVudC5wcm90b3R5cGUgPSB7XG5cdG5vZGVOYW1lIDogXCIjY29tbWVudFwiLFxuXHRub2RlVHlwZSA6IENPTU1FTlRfTk9ERVxufVxuX2V4dGVuZHMoQ29tbWVudCxDaGFyYWN0ZXJEYXRhKTtcblxuZnVuY3Rpb24gQ0RBVEFTZWN0aW9uKCkge1xufTtcbkNEQVRBU2VjdGlvbi5wcm90b3R5cGUgPSB7XG5cdG5vZGVOYW1lIDogXCIjY2RhdGEtc2VjdGlvblwiLFxuXHRub2RlVHlwZSA6IENEQVRBX1NFQ1RJT05fTk9ERVxufVxuX2V4dGVuZHMoQ0RBVEFTZWN0aW9uLENoYXJhY3RlckRhdGEpO1xuXG5cbmZ1bmN0aW9uIERvY3VtZW50VHlwZSgpIHtcbn07XG5Eb2N1bWVudFR5cGUucHJvdG90eXBlLm5vZGVUeXBlID0gRE9DVU1FTlRfVFlQRV9OT0RFO1xuX2V4dGVuZHMoRG9jdW1lbnRUeXBlLE5vZGUpO1xuXG5mdW5jdGlvbiBOb3RhdGlvbigpIHtcbn07XG5Ob3RhdGlvbi5wcm90b3R5cGUubm9kZVR5cGUgPSBOT1RBVElPTl9OT0RFO1xuX2V4dGVuZHMoTm90YXRpb24sTm9kZSk7XG5cbmZ1bmN0aW9uIEVudGl0eSgpIHtcbn07XG5FbnRpdHkucHJvdG90eXBlLm5vZGVUeXBlID0gRU5USVRZX05PREU7XG5fZXh0ZW5kcyhFbnRpdHksTm9kZSk7XG5cbmZ1bmN0aW9uIEVudGl0eVJlZmVyZW5jZSgpIHtcbn07XG5FbnRpdHlSZWZlcmVuY2UucHJvdG90eXBlLm5vZGVUeXBlID0gRU5USVRZX1JFRkVSRU5DRV9OT0RFO1xuX2V4dGVuZHMoRW50aXR5UmVmZXJlbmNlLE5vZGUpO1xuXG5mdW5jdGlvbiBEb2N1bWVudEZyYWdtZW50KCkge1xufTtcbkRvY3VtZW50RnJhZ21lbnQucHJvdG90eXBlLm5vZGVOYW1lID1cdFwiI2RvY3VtZW50LWZyYWdtZW50XCI7XG5Eb2N1bWVudEZyYWdtZW50LnByb3RvdHlwZS5ub2RlVHlwZSA9XHRET0NVTUVOVF9GUkFHTUVOVF9OT0RFO1xuX2V4dGVuZHMoRG9jdW1lbnRGcmFnbWVudCxOb2RlKTtcblxuXG5mdW5jdGlvbiBQcm9jZXNzaW5nSW5zdHJ1Y3Rpb24oKSB7XG59XG5Qcm9jZXNzaW5nSW5zdHJ1Y3Rpb24ucHJvdG90eXBlLm5vZGVUeXBlID0gUFJPQ0VTU0lOR19JTlNUUlVDVElPTl9OT0RFO1xuX2V4dGVuZHMoUHJvY2Vzc2luZ0luc3RydWN0aW9uLE5vZGUpO1xuZnVuY3Rpb24gWE1MU2VyaWFsaXplcigpe31cblhNTFNlcmlhbGl6ZXIucHJvdG90eXBlLnNlcmlhbGl6ZVRvU3RyaW5nID0gZnVuY3Rpb24obm9kZSl7XG5cdHZhciBidWYgPSBbXTtcblx0c2VyaWFsaXplVG9TdHJpbmcobm9kZSxidWYpO1xuXHRyZXR1cm4gYnVmLmpvaW4oJycpO1xufVxuTm9kZS5wcm90b3R5cGUudG9TdHJpbmcgPWZ1bmN0aW9uKCl7XG5cdHJldHVybiBYTUxTZXJpYWxpemVyLnByb3RvdHlwZS5zZXJpYWxpemVUb1N0cmluZyh0aGlzKTtcbn1cbmZ1bmN0aW9uIHNlcmlhbGl6ZVRvU3RyaW5nKG5vZGUsYnVmKXtcblx0c3dpdGNoKG5vZGUubm9kZVR5cGUpe1xuXHRjYXNlIEVMRU1FTlRfTk9ERTpcblx0XHR2YXIgYXR0cnMgPSBub2RlLmF0dHJpYnV0ZXM7XG5cdFx0dmFyIGxlbiA9IGF0dHJzLmxlbmd0aDtcblx0XHR2YXIgY2hpbGQgPSBub2RlLmZpcnN0Q2hpbGQ7XG5cdFx0dmFyIG5vZGVOYW1lID0gbm9kZS50YWdOYW1lO1xuXHRcdHZhciBpc0hUTUwgPSBodG1sbnMgPT09IG5vZGUubmFtZXNwYWNlVVJJXG5cdFx0YnVmLnB1c2goJzwnLG5vZGVOYW1lKTtcblx0XHRmb3IodmFyIGk9MDtpPGxlbjtpKyspe1xuXHRcdFx0c2VyaWFsaXplVG9TdHJpbmcoYXR0cnMuaXRlbShpKSxidWYsaXNIVE1MKTtcblx0XHR9XG5cdFx0aWYoY2hpbGQgfHwgaXNIVE1MICYmICEvXig/Om1ldGF8bGlua3xpbWd8YnJ8aHJ8aW5wdXQpJC9pLnRlc3Qobm9kZU5hbWUpKXtcblx0XHRcdGJ1Zi5wdXNoKCc+Jyk7XG5cdFx0XHQvL2lmIGlzIGNkYXRhIGNoaWxkIG5vZGVcblx0XHRcdGlmKGlzSFRNTCAmJiAvXnNjcmlwdCQvaS50ZXN0KG5vZGVOYW1lKSl7XG5cdFx0XHRcdGlmKGNoaWxkKXtcblx0XHRcdFx0XHRidWYucHVzaChjaGlsZC5kYXRhKTtcblx0XHRcdFx0fVxuXHRcdFx0fWVsc2V7XG5cdFx0XHRcdHdoaWxlKGNoaWxkKXtcblx0XHRcdFx0XHRzZXJpYWxpemVUb1N0cmluZyhjaGlsZCxidWYpO1xuXHRcdFx0XHRcdGNoaWxkID0gY2hpbGQubmV4dFNpYmxpbmc7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHRcdGJ1Zi5wdXNoKCc8Lycsbm9kZU5hbWUsJz4nKTtcblx0XHR9ZWxzZXtcblx0XHRcdGJ1Zi5wdXNoKCcvPicpO1xuXHRcdH1cblx0XHRyZXR1cm47XG5cdGNhc2UgRE9DVU1FTlRfTk9ERTpcblx0Y2FzZSBET0NVTUVOVF9GUkFHTUVOVF9OT0RFOlxuXHRcdHZhciBjaGlsZCA9IG5vZGUuZmlyc3RDaGlsZDtcblx0XHR3aGlsZShjaGlsZCl7XG5cdFx0XHRzZXJpYWxpemVUb1N0cmluZyhjaGlsZCxidWYpO1xuXHRcdFx0Y2hpbGQgPSBjaGlsZC5uZXh0U2libGluZztcblx0XHR9XG5cdFx0cmV0dXJuO1xuXHRjYXNlIEFUVFJJQlVURV9OT0RFOlxuXHRcdHJldHVybiBidWYucHVzaCgnICcsbm9kZS5uYW1lLCc9XCInLG5vZGUudmFsdWUucmVwbGFjZSgvWzwmXCJdL2csX3htbEVuY29kZXIpLCdcIicpO1xuXHRjYXNlIFRFWFRfTk9ERTpcblx0XHRyZXR1cm4gYnVmLnB1c2gobm9kZS5kYXRhLnJlcGxhY2UoL1s8Jl0vZyxfeG1sRW5jb2RlcikpO1xuXHRjYXNlIENEQVRBX1NFQ1RJT05fTk9ERTpcblx0XHRyZXR1cm4gYnVmLnB1c2goICc8IVtDREFUQVsnLG5vZGUuZGF0YSwnXV0+Jyk7XG5cdGNhc2UgQ09NTUVOVF9OT0RFOlxuXHRcdHJldHVybiBidWYucHVzaCggXCI8IS0tXCIsbm9kZS5kYXRhLFwiLS0+XCIpO1xuXHRjYXNlIERPQ1VNRU5UX1RZUEVfTk9ERTpcblx0XHR2YXIgcHViaWQgPSBub2RlLnB1YmxpY0lkO1xuXHRcdHZhciBzeXNpZCA9IG5vZGUuc3lzdGVtSWQ7XG5cdFx0YnVmLnB1c2goJzwhRE9DVFlQRSAnLG5vZGUubmFtZSk7XG5cdFx0aWYocHViaWQpe1xuXHRcdFx0YnVmLnB1c2goJyBQVUJMSUMgXCInLHB1YmlkKTtcblx0XHRcdGlmIChzeXNpZCAmJiBzeXNpZCE9Jy4nKSB7XG5cdFx0XHRcdGJ1Zi5wdXNoKCAnXCIgXCInLHN5c2lkKTtcblx0XHRcdH1cblx0XHRcdGJ1Zi5wdXNoKCdcIj4nKTtcblx0XHR9ZWxzZSBpZihzeXNpZCAmJiBzeXNpZCE9Jy4nKXtcblx0XHRcdGJ1Zi5wdXNoKCcgU1lTVEVNIFwiJyxzeXNpZCwnXCI+Jyk7XG5cdFx0fWVsc2V7XG5cdFx0XHR2YXIgc3ViID0gbm9kZS5pbnRlcm5hbFN1YnNldDtcblx0XHRcdGlmKHN1Yil7XG5cdFx0XHRcdGJ1Zi5wdXNoKFwiIFtcIixzdWIsXCJdXCIpO1xuXHRcdFx0fVxuXHRcdFx0YnVmLnB1c2goXCI+XCIpO1xuXHRcdH1cblx0XHRyZXR1cm47XG5cdGNhc2UgUFJPQ0VTU0lOR19JTlNUUlVDVElPTl9OT0RFOlxuXHRcdHJldHVybiBidWYucHVzaCggXCI8P1wiLG5vZGUudGFyZ2V0LFwiIFwiLG5vZGUuZGF0YSxcIj8+XCIpO1xuXHRjYXNlIEVOVElUWV9SRUZFUkVOQ0VfTk9ERTpcblx0XHRyZXR1cm4gYnVmLnB1c2goICcmJyxub2RlLm5vZGVOYW1lLCc7Jyk7XG5cdC8vY2FzZSBFTlRJVFlfTk9ERTpcblx0Ly9jYXNlIE5PVEFUSU9OX05PREU6XG5cdGRlZmF1bHQ6XG5cdFx0YnVmLnB1c2goJz8/Jyxub2RlLm5vZGVOYW1lKTtcblx0fVxufVxuZnVuY3Rpb24gaW1wb3J0Tm9kZShkb2Msbm9kZSxkZWVwKXtcblx0dmFyIG5vZGUyO1xuXHRzd2l0Y2ggKG5vZGUubm9kZVR5cGUpIHtcblx0Y2FzZSBFTEVNRU5UX05PREU6XG5cdFx0bm9kZTIgPSBub2RlLmNsb25lTm9kZShmYWxzZSk7XG5cdFx0bm9kZTIub3duZXJEb2N1bWVudCA9IGRvYztcblx0XHQvL3ZhciBhdHRycyA9IG5vZGUyLmF0dHJpYnV0ZXM7XG5cdFx0Ly92YXIgbGVuID0gYXR0cnMubGVuZ3RoO1xuXHRcdC8vZm9yKHZhciBpPTA7aTxsZW47aSsrKXtcblx0XHRcdC8vbm9kZTIuc2V0QXR0cmlidXRlTm9kZU5TKGltcG9ydE5vZGUoZG9jLGF0dHJzLml0ZW0oaSksZGVlcCkpO1xuXHRcdC8vfVxuXHRjYXNlIERPQ1VNRU5UX0ZSQUdNRU5UX05PREU6XG5cdFx0YnJlYWs7XG5cdGNhc2UgQVRUUklCVVRFX05PREU6XG5cdFx0ZGVlcCA9IHRydWU7XG5cdFx0YnJlYWs7XG5cdC8vY2FzZSBFTlRJVFlfUkVGRVJFTkNFX05PREU6XG5cdC8vY2FzZSBQUk9DRVNTSU5HX0lOU1RSVUNUSU9OX05PREU6XG5cdC8vLy9jYXNlIFRFWFRfTk9ERTpcblx0Ly9jYXNlIENEQVRBX1NFQ1RJT05fTk9ERTpcblx0Ly9jYXNlIENPTU1FTlRfTk9ERTpcblx0Ly9cdGRlZXAgPSBmYWxzZTtcblx0Ly9cdGJyZWFrO1xuXHQvL2Nhc2UgRE9DVU1FTlRfTk9ERTpcblx0Ly9jYXNlIERPQ1VNRU5UX1RZUEVfTk9ERTpcblx0Ly9jYW5ub3QgYmUgaW1wb3J0ZWQuXG5cdC8vY2FzZSBFTlRJVFlfTk9ERTpcblx0Ly9jYXNlIE5PVEFUSU9OX05PREXvvJpcblx0Ly9jYW4gbm90IGhpdCBpbiBsZXZlbDNcblx0Ly9kZWZhdWx0OnRocm93IGU7XG5cdH1cblx0aWYoIW5vZGUyKXtcblx0XHRub2RlMiA9IG5vZGUuY2xvbmVOb2RlKGZhbHNlKTsvL2ZhbHNlXG5cdH1cblx0bm9kZTIub3duZXJEb2N1bWVudCA9IGRvYztcblx0bm9kZTIucGFyZW50Tm9kZSA9IG51bGw7XG5cdGlmKGRlZXApe1xuXHRcdHZhciBjaGlsZCA9IG5vZGUuZmlyc3RDaGlsZDtcblx0XHR3aGlsZShjaGlsZCl7XG5cdFx0XHRub2RlMi5hcHBlbmRDaGlsZChpbXBvcnROb2RlKGRvYyxjaGlsZCxkZWVwKSk7XG5cdFx0XHRjaGlsZCA9IGNoaWxkLm5leHRTaWJsaW5nO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gbm9kZTI7XG59XG4vL1xuLy92YXIgX3JlbGF0aW9uTWFwID0ge2ZpcnN0Q2hpbGQ6MSxsYXN0Q2hpbGQ6MSxwcmV2aW91c1NpYmxpbmc6MSxuZXh0U2libGluZzoxLFxuLy9cdFx0XHRcdFx0YXR0cmlidXRlczoxLGNoaWxkTm9kZXM6MSxwYXJlbnROb2RlOjEsZG9jdW1lbnRFbGVtZW50OjEsZG9jdHlwZSx9O1xuZnVuY3Rpb24gY2xvbmVOb2RlKGRvYyxub2RlLGRlZXApe1xuXHR2YXIgbm9kZTIgPSBuZXcgbm9kZS5jb25zdHJ1Y3RvcigpO1xuXHRmb3IodmFyIG4gaW4gbm9kZSl7XG5cdFx0dmFyIHYgPSBub2RlW25dO1xuXHRcdGlmKHR5cGVvZiB2ICE9ICdvYmplY3QnICl7XG5cdFx0XHRpZih2ICE9IG5vZGUyW25dKXtcblx0XHRcdFx0bm9kZTJbbl0gPSB2O1xuXHRcdFx0fVxuXHRcdH1cblx0fVxuXHRpZihub2RlLmNoaWxkTm9kZXMpe1xuXHRcdG5vZGUyLmNoaWxkTm9kZXMgPSBuZXcgTm9kZUxpc3QoKTtcblx0fVxuXHRub2RlMi5vd25lckRvY3VtZW50ID0gZG9jO1xuXHRzd2l0Y2ggKG5vZGUyLm5vZGVUeXBlKSB7XG5cdGNhc2UgRUxFTUVOVF9OT0RFOlxuXHRcdHZhciBhdHRyc1x0PSBub2RlLmF0dHJpYnV0ZXM7XG5cdFx0dmFyIGF0dHJzMlx0PSBub2RlMi5hdHRyaWJ1dGVzID0gbmV3IE5hbWVkTm9kZU1hcCgpO1xuXHRcdHZhciBsZW4gPSBhdHRycy5sZW5ndGhcblx0XHRhdHRyczIuX293bmVyRWxlbWVudCA9IG5vZGUyO1xuXHRcdGZvcih2YXIgaT0wO2k8bGVuO2krKyl7XG5cdFx0XHRub2RlMi5zZXRBdHRyaWJ1dGVOb2RlKGNsb25lTm9kZShkb2MsYXR0cnMuaXRlbShpKSx0cnVlKSk7XG5cdFx0fVxuXHRcdGJyZWFrOztcblx0Y2FzZSBBVFRSSUJVVEVfTk9ERTpcblx0XHRkZWVwID0gdHJ1ZTtcblx0fVxuXHRpZihkZWVwKXtcblx0XHR2YXIgY2hpbGQgPSBub2RlLmZpcnN0Q2hpbGQ7XG5cdFx0d2hpbGUoY2hpbGQpe1xuXHRcdFx0bm9kZTIuYXBwZW5kQ2hpbGQoY2xvbmVOb2RlKGRvYyxjaGlsZCxkZWVwKSk7XG5cdFx0XHRjaGlsZCA9IGNoaWxkLm5leHRTaWJsaW5nO1xuXHRcdH1cblx0fVxuXHRyZXR1cm4gbm9kZTI7XG59XG5cbmZ1bmN0aW9uIF9fc2V0X18ob2JqZWN0LGtleSx2YWx1ZSl7XG5cdG9iamVjdFtrZXldID0gdmFsdWVcbn1cbi8vZG8gZHluYW1pY1xudHJ5e1xuXHRpZihPYmplY3QuZGVmaW5lUHJvcGVydHkpe1xuXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShMaXZlTm9kZUxpc3QucHJvdG90eXBlLCdsZW5ndGgnLHtcblx0XHRcdGdldDpmdW5jdGlvbigpe1xuXHRcdFx0XHRfdXBkYXRlTGl2ZUxpc3QodGhpcyk7XG5cdFx0XHRcdHJldHVybiB0aGlzLiQkbGVuZ3RoO1xuXHRcdFx0fVxuXHRcdH0pO1xuXHRcdE9iamVjdC5kZWZpbmVQcm9wZXJ0eShOb2RlLnByb3RvdHlwZSwndGV4dENvbnRlbnQnLHtcblx0XHRcdGdldDpmdW5jdGlvbigpe1xuXHRcdFx0XHRyZXR1cm4gZ2V0VGV4dENvbnRlbnQodGhpcyk7XG5cdFx0XHR9LFxuXHRcdFx0c2V0OmZ1bmN0aW9uKGRhdGEpe1xuXHRcdFx0XHRzd2l0Y2godGhpcy5ub2RlVHlwZSl7XG5cdFx0XHRcdGNhc2UgMTpcblx0XHRcdFx0Y2FzZSAxMTpcblx0XHRcdFx0XHR3aGlsZSh0aGlzLmZpcnN0Q2hpbGQpe1xuXHRcdFx0XHRcdFx0dGhpcy5yZW1vdmVDaGlsZCh0aGlzLmZpcnN0Q2hpbGQpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRpZihkYXRhIHx8IFN0cmluZyhkYXRhKSl7XG5cdFx0XHRcdFx0XHR0aGlzLmFwcGVuZENoaWxkKHRoaXMub3duZXJEb2N1bWVudC5jcmVhdGVUZXh0Tm9kZShkYXRhKSk7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGJyZWFrO1xuXHRcdFx0XHRkZWZhdWx0OlxuXHRcdFx0XHRcdC8vVE9ETzpcblx0XHRcdFx0XHR0aGlzLmRhdGEgPSBkYXRhO1xuXHRcdFx0XHRcdHRoaXMudmFsdWUgPSB2YWx1ZTtcblx0XHRcdFx0XHR0aGlzLm5vZGVWYWx1ZSA9IGRhdGE7XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9KVxuXHRcdFxuXHRcdGZ1bmN0aW9uIGdldFRleHRDb250ZW50KG5vZGUpe1xuXHRcdFx0c3dpdGNoKG5vZGUubm9kZVR5cGUpe1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0Y2FzZSAxMTpcblx0XHRcdFx0dmFyIGJ1ZiA9IFtdO1xuXHRcdFx0XHRub2RlID0gbm9kZS5maXJzdENoaWxkO1xuXHRcdFx0XHR3aGlsZShub2RlKXtcblx0XHRcdFx0XHRpZihub2RlLm5vZGVUeXBlIT09NyAmJiBub2RlLm5vZGVUeXBlICE9PTgpe1xuXHRcdFx0XHRcdFx0YnVmLnB1c2goZ2V0VGV4dENvbnRlbnQobm9kZSkpO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRub2RlID0gbm9kZS5uZXh0U2libGluZztcblx0XHRcdFx0fVxuXHRcdFx0XHRyZXR1cm4gYnVmLmpvaW4oJycpO1xuXHRcdFx0ZGVmYXVsdDpcblx0XHRcdFx0cmV0dXJuIG5vZGUubm9kZVZhbHVlO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRfX3NldF9fID0gZnVuY3Rpb24ob2JqZWN0LGtleSx2YWx1ZSl7XG5cdFx0XHQvL2NvbnNvbGUubG9nKHZhbHVlKVxuXHRcdFx0b2JqZWN0WyckJCcra2V5XSA9IHZhbHVlXG5cdFx0fVxuXHR9XG59Y2F0Y2goZSl7Ly9pZThcbn1cblxuaWYodHlwZW9mIHJlcXVpcmUgPT0gJ2Z1bmN0aW9uJyl7XG5cdGV4cG9ydHMuRE9NSW1wbGVtZW50YXRpb24gPSBET01JbXBsZW1lbnRhdGlvbjtcblx0ZXhwb3J0cy5YTUxTZXJpYWxpemVyID0gWE1MU2VyaWFsaXplcjtcbn1cblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJWQ21Fc3dcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLlxcXFxub2RlX21vZHVsZXNcXFxceG1sZG9tXFxcXGRvbS5qc1wiLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFx4bWxkb21cIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vL1s0XSAgIFx0TmFtZVN0YXJ0Q2hhclx0ICAgOjo9ICAgXHRcIjpcIiB8IFtBLVpdIHwgXCJfXCIgfCBbYS16XSB8IFsjeEMwLSN4RDZdIHwgWyN4RDgtI3hGNl0gfCBbI3hGOC0jeDJGRl0gfCBbI3gzNzAtI3gzN0RdIHwgWyN4MzdGLSN4MUZGRl0gfCBbI3gyMDBDLSN4MjAwRF0gfCBbI3gyMDcwLSN4MjE4Rl0gfCBbI3gyQzAwLSN4MkZFRl0gfCBbI3gzMDAxLSN4RDdGRl0gfCBbI3hGOTAwLSN4RkRDRl0gfCBbI3hGREYwLSN4RkZGRF0gfCBbI3gxMDAwMC0jeEVGRkZGXVxyXG4vL1s0YV0gICBcdE5hbWVDaGFyXHQgICA6Oj0gICBcdE5hbWVTdGFydENoYXIgfCBcIi1cIiB8IFwiLlwiIHwgWzAtOV0gfCAjeEI3IHwgWyN4MDMwMC0jeDAzNkZdIHwgWyN4MjAzRi0jeDIwNDBdXHJcbi8vWzVdICAgXHROYW1lXHQgICA6Oj0gICBcdE5hbWVTdGFydENoYXIgKE5hbWVDaGFyKSpcclxudmFyIG5hbWVTdGFydENoYXIgPSAvW0EtWl9hLXpcXHhDMC1cXHhENlxceEQ4LVxceEY2XFx1MDBGOC1cXHUwMkZGXFx1MDM3MC1cXHUwMzdEXFx1MDM3Ri1cXHUxRkZGXFx1MjAwQy1cXHUyMDBEXFx1MjA3MC1cXHUyMThGXFx1MkMwMC1cXHUyRkVGXFx1MzAwMS1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkZEXS8vL1xcdTEwMDAwLVxcdUVGRkZGXHJcbnZhciBuYW1lQ2hhciA9IG5ldyBSZWdFeHAoXCJbXFxcXC1cXFxcLjAtOVwiK25hbWVTdGFydENoYXIuc291cmNlLnNsaWNlKDEsLTEpK1wiXFx1MDBCN1xcdTAzMDAtXFx1MDM2RlxcXFx1eDIwM0YtXFx1MjA0MF1cIik7XHJcbnZhciB0YWdOYW1lUGF0dGVybiA9IG5ldyBSZWdFeHAoJ14nK25hbWVTdGFydENoYXIuc291cmNlK25hbWVDaGFyLnNvdXJjZSsnKig/OlxcOicrbmFtZVN0YXJ0Q2hhci5zb3VyY2UrbmFtZUNoYXIuc291cmNlKycqKT8kJyk7XHJcbi8vdmFyIHRhZ05hbWVQYXR0ZXJuID0gL15bYS16QS1aX11bXFx3XFwtXFwuXSooPzpcXDpbYS16QS1aX11bXFx3XFwtXFwuXSopPyQvXHJcbi8vdmFyIGhhbmRsZXJzID0gJ3Jlc29sdmVFbnRpdHksZ2V0RXh0ZXJuYWxTdWJzZXQsY2hhcmFjdGVycyxlbmREb2N1bWVudCxlbmRFbGVtZW50LGVuZFByZWZpeE1hcHBpbmcsaWdub3JhYmxlV2hpdGVzcGFjZSxwcm9jZXNzaW5nSW5zdHJ1Y3Rpb24sc2V0RG9jdW1lbnRMb2NhdG9yLHNraXBwZWRFbnRpdHksc3RhcnREb2N1bWVudCxzdGFydEVsZW1lbnQsc3RhcnRQcmVmaXhNYXBwaW5nLG5vdGF0aW9uRGVjbCx1bnBhcnNlZEVudGl0eURlY2wsZXJyb3IsZmF0YWxFcnJvcix3YXJuaW5nLGF0dHJpYnV0ZURlY2wsZWxlbWVudERlY2wsZXh0ZXJuYWxFbnRpdHlEZWNsLGludGVybmFsRW50aXR5RGVjbCxjb21tZW50LGVuZENEQVRBLGVuZERURCxlbmRFbnRpdHksc3RhcnRDREFUQSxzdGFydERURCxzdGFydEVudGl0eScuc3BsaXQoJywnKVxyXG5cclxuLy9TX1RBRyxcdFNfQVRUUixcdFNfRVEsXHRTX1ZcclxuLy9TX0FUVFJfUyxcdFNfRSxcdFNfUyxcdFNfQ1xyXG52YXIgU19UQUcgPSAwOy8vdGFnIG5hbWUgb2ZmZXJyaW5nXHJcbnZhciBTX0FUVFIgPSAxOy8vYXR0ciBuYW1lIG9mZmVycmluZyBcclxudmFyIFNfQVRUUl9TPTI7Ly9hdHRyIG5hbWUgZW5kIGFuZCBzcGFjZSBvZmZlclxyXG52YXIgU19FUSA9IDM7Ly89c3BhY2U/XHJcbnZhciBTX1YgPSA0Oy8vYXR0ciB2YWx1ZShubyBxdW90IHZhbHVlIG9ubHkpXHJcbnZhciBTX0UgPSA1Oy8vYXR0ciB2YWx1ZSBlbmQgYW5kIG5vIHNwYWNlKHF1b3QgZW5kKVxyXG52YXIgU19TID0gNjsvLyhhdHRyIHZhbHVlIGVuZCB8fCB0YWcgZW5kICkgJiYgKHNwYWNlIG9mZmVyKVxyXG52YXIgU19DID0gNzsvL2Nsb3NlZCBlbDxlbCAvPlxyXG5cclxuZnVuY3Rpb24gWE1MUmVhZGVyKCl7XHJcblx0XHJcbn1cclxuXHJcblhNTFJlYWRlci5wcm90b3R5cGUgPSB7XHJcblx0cGFyc2U6ZnVuY3Rpb24oc291cmNlLGRlZmF1bHROU01hcCxlbnRpdHlNYXApe1xyXG5cdFx0dmFyIGRvbUJ1aWxkZXIgPSB0aGlzLmRvbUJ1aWxkZXI7XHJcblx0XHRkb21CdWlsZGVyLnN0YXJ0RG9jdW1lbnQoKTtcclxuXHRcdF9jb3B5KGRlZmF1bHROU01hcCAsZGVmYXVsdE5TTWFwID0ge30pXHJcblx0XHRwYXJzZShzb3VyY2UsZGVmYXVsdE5TTWFwLGVudGl0eU1hcCxcclxuXHRcdFx0XHRkb21CdWlsZGVyLHRoaXMuZXJyb3JIYW5kbGVyKTtcclxuXHRcdGRvbUJ1aWxkZXIuZW5kRG9jdW1lbnQoKTtcclxuXHR9XHJcbn1cclxuZnVuY3Rpb24gcGFyc2Uoc291cmNlLGRlZmF1bHROU01hcENvcHksZW50aXR5TWFwLGRvbUJ1aWxkZXIsZXJyb3JIYW5kbGVyKXtcclxuICBmdW5jdGlvbiBmaXhlZEZyb21DaGFyQ29kZShjb2RlKSB7XHJcblx0XHQvLyBTdHJpbmcucHJvdG90eXBlLmZyb21DaGFyQ29kZSBkb2VzIG5vdCBzdXBwb3J0c1xyXG5cdFx0Ly8gPiAyIGJ5dGVzIHVuaWNvZGUgY2hhcnMgZGlyZWN0bHlcclxuXHRcdGlmIChjb2RlID4gMHhmZmZmKSB7XHJcblx0XHRcdGNvZGUgLT0gMHgxMDAwMDtcclxuXHRcdFx0dmFyIHN1cnJvZ2F0ZTEgPSAweGQ4MDAgKyAoY29kZSA+PiAxMClcclxuXHRcdFx0XHQsIHN1cnJvZ2F0ZTIgPSAweGRjMDAgKyAoY29kZSAmIDB4M2ZmKTtcclxuXHJcblx0XHRcdHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlKHN1cnJvZ2F0ZTEsIHN1cnJvZ2F0ZTIpO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0cmV0dXJuIFN0cmluZy5mcm9tQ2hhckNvZGUoY29kZSk7XHJcblx0XHR9XHJcblx0fVxyXG5cdGZ1bmN0aW9uIGVudGl0eVJlcGxhY2VyKGEpe1xyXG5cdFx0dmFyIGsgPSBhLnNsaWNlKDEsLTEpO1xyXG5cdFx0aWYoayBpbiBlbnRpdHlNYXApe1xyXG5cdFx0XHRyZXR1cm4gZW50aXR5TWFwW2tdOyBcclxuXHRcdH1lbHNlIGlmKGsuY2hhckF0KDApID09PSAnIycpe1xyXG5cdFx0XHRyZXR1cm4gZml4ZWRGcm9tQ2hhckNvZGUocGFyc2VJbnQoay5zdWJzdHIoMSkucmVwbGFjZSgneCcsJzB4JykpKVxyXG5cdFx0fWVsc2V7XHJcblx0XHRcdGVycm9ySGFuZGxlci5lcnJvcignZW50aXR5IG5vdCBmb3VuZDonK2EpO1xyXG5cdFx0XHRyZXR1cm4gYTtcclxuXHRcdH1cclxuXHR9XHJcblx0ZnVuY3Rpb24gYXBwZW5kVGV4dChlbmQpey8vaGFzIHNvbWUgYnVnc1xyXG5cdFx0dmFyIHh0ID0gc291cmNlLnN1YnN0cmluZyhzdGFydCxlbmQpLnJlcGxhY2UoLyYjP1xcdys7L2csZW50aXR5UmVwbGFjZXIpO1xyXG5cdFx0bG9jYXRvciYmcG9zaXRpb24oc3RhcnQpO1xyXG5cdFx0ZG9tQnVpbGRlci5jaGFyYWN0ZXJzKHh0LDAsZW5kLXN0YXJ0KTtcclxuXHRcdHN0YXJ0ID0gZW5kXHJcblx0fVxyXG5cdGZ1bmN0aW9uIHBvc2l0aW9uKHN0YXJ0LG0pe1xyXG5cdFx0d2hpbGUoc3RhcnQ+PWVuZFBvcyAmJiAobSA9IGxpbmVQYXR0ZXJuLmV4ZWMoc291cmNlKSkpe1xyXG5cdFx0XHRzdGFydFBvcyA9IG0uaW5kZXg7XHJcblx0XHRcdGVuZFBvcyA9IHN0YXJ0UG9zICsgbVswXS5sZW5ndGg7XHJcblx0XHRcdGxvY2F0b3IubGluZU51bWJlcisrO1xyXG5cdFx0XHQvL2NvbnNvbGUubG9nKCdsaW5lKys6Jyxsb2NhdG9yLHN0YXJ0UG9zLGVuZFBvcylcclxuXHRcdH1cclxuXHRcdGxvY2F0b3IuY29sdW1uTnVtYmVyID0gc3RhcnQtc3RhcnRQb3MrMTtcclxuXHR9XHJcblx0dmFyIHN0YXJ0UG9zID0gMDtcclxuXHR2YXIgZW5kUG9zID0gMDtcclxuXHR2YXIgbGluZVBhdHRlcm4gPSAvLisoPzpcXHJcXG4/fFxcbil8LiokL2dcclxuXHR2YXIgbG9jYXRvciA9IGRvbUJ1aWxkZXIubG9jYXRvcjtcclxuXHRcclxuXHR2YXIgcGFyc2VTdGFjayA9IFt7Y3VycmVudE5TTWFwOmRlZmF1bHROU01hcENvcHl9XVxyXG5cdHZhciBjbG9zZU1hcCA9IHt9O1xyXG5cdHZhciBzdGFydCA9IDA7XHJcblx0d2hpbGUodHJ1ZSl7XHJcblx0XHR2YXIgaSA9IHNvdXJjZS5pbmRleE9mKCc8JyxzdGFydCk7XHJcblx0XHRpZihpPDApe1xyXG5cdFx0XHRpZighc291cmNlLnN1YnN0cihzdGFydCkubWF0Y2goL15cXHMqJC8pKXtcclxuXHRcdFx0XHR2YXIgZG9jID0gZG9tQnVpbGRlci5kb2N1bWVudDtcclxuICAgIFx0XHRcdHZhciB0ZXh0ID0gZG9jLmNyZWF0ZVRleHROb2RlKHNvdXJjZS5zdWJzdHIoc3RhcnQpKTtcclxuICAgIFx0XHRcdGRvYy5hcHBlbmRDaGlsZCh0ZXh0KTtcclxuICAgIFx0XHRcdGRvbUJ1aWxkZXIuY3VycmVudEVsZW1lbnQgPSB0ZXh0O1xyXG5cdFx0XHR9XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHRcdGlmKGk+c3RhcnQpe1xyXG5cdFx0XHRhcHBlbmRUZXh0KGkpO1xyXG5cdFx0fVxyXG5cdFx0c3dpdGNoKHNvdXJjZS5jaGFyQXQoaSsxKSl7XHJcblx0XHRjYXNlICcvJzpcclxuXHRcdFx0dmFyIGVuZCA9IHNvdXJjZS5pbmRleE9mKCc+JyxpKzMpO1xyXG5cdFx0XHR2YXIgdGFnTmFtZSA9IHNvdXJjZS5zdWJzdHJpbmcoaSsyLGVuZCk7XHJcblx0XHRcdHZhciBjb25maWcgPSBwYXJzZVN0YWNrLnBvcCgpO1xyXG5cdFx0XHR2YXIgbG9jYWxOU01hcCA9IGNvbmZpZy5sb2NhbE5TTWFwO1xyXG5cdFx0XHRcclxuXHQgICAgICAgIGlmKGNvbmZpZy50YWdOYW1lICE9IHRhZ05hbWUpe1xyXG5cdCAgICAgICAgICAgIGVycm9ySGFuZGxlci5mYXRhbEVycm9yKFwiZW5kIHRhZyBuYW1lOiBcIit0YWdOYW1lKycgaXMgbm90IG1hdGNoIHRoZSBjdXJyZW50IHN0YXJ0IHRhZ05hbWU6Jytjb25maWcudGFnTmFtZSApO1xyXG5cdCAgICAgICAgfVxyXG5cdFx0XHRkb21CdWlsZGVyLmVuZEVsZW1lbnQoY29uZmlnLnVyaSxjb25maWcubG9jYWxOYW1lLHRhZ05hbWUpO1xyXG5cdFx0XHRpZihsb2NhbE5TTWFwKXtcclxuXHRcdFx0XHRmb3IodmFyIHByZWZpeCBpbiBsb2NhbE5TTWFwKXtcclxuXHRcdFx0XHRcdGRvbUJ1aWxkZXIuZW5kUHJlZml4TWFwcGluZyhwcmVmaXgpIDtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdFx0ZW5kKys7XHJcblx0XHRcdGJyZWFrO1xyXG5cdFx0XHQvLyBlbmQgZWxtZW50XHJcblx0XHRjYXNlICc/JzovLyA8Py4uLj8+XHJcblx0XHRcdGxvY2F0b3ImJnBvc2l0aW9uKGkpO1xyXG5cdFx0XHRlbmQgPSBwYXJzZUluc3RydWN0aW9uKHNvdXJjZSxpLGRvbUJ1aWxkZXIpO1xyXG5cdFx0XHRicmVhaztcclxuXHRcdGNhc2UgJyEnOi8vIDwhZG9jdHlwZSw8IVtDREFUQSw8IS0tXHJcblx0XHRcdGxvY2F0b3ImJnBvc2l0aW9uKGkpO1xyXG5cdFx0XHRlbmQgPSBwYXJzZURDQyhzb3VyY2UsaSxkb21CdWlsZGVyLGVycm9ySGFuZGxlcik7XHJcblx0XHRcdGJyZWFrO1xyXG5cdFx0ZGVmYXVsdDpcclxuXHRcdFx0dHJ5e1xyXG5cdFx0XHRcdGxvY2F0b3ImJnBvc2l0aW9uKGkpO1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdHZhciBlbCA9IG5ldyBFbGVtZW50QXR0cmlidXRlcygpO1xyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdC8vZWxTdGFydEVuZFxyXG5cdFx0XHRcdHZhciBlbmQgPSBwYXJzZUVsZW1lbnRTdGFydFBhcnQoc291cmNlLGksZWwsZW50aXR5UmVwbGFjZXIsZXJyb3JIYW5kbGVyKTtcclxuXHRcdFx0XHR2YXIgbGVuID0gZWwubGVuZ3RoO1xyXG5cdFx0XHRcdC8vcG9zaXRpb24gZml4ZWRcclxuXHRcdFx0XHRpZihsZW4gJiYgbG9jYXRvcil7XHJcblx0XHRcdFx0XHR2YXIgYmFja3VwID0gY29weUxvY2F0b3IobG9jYXRvcix7fSk7XHJcblx0XHRcdFx0XHRmb3IodmFyIGkgPSAwO2k8bGVuO2krKyl7XHJcblx0XHRcdFx0XHRcdHZhciBhID0gZWxbaV07XHJcblx0XHRcdFx0XHRcdHBvc2l0aW9uKGEub2Zmc2V0KTtcclxuXHRcdFx0XHRcdFx0YS5vZmZzZXQgPSBjb3B5TG9jYXRvcihsb2NhdG9yLHt9KTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGNvcHlMb2NhdG9yKGJhY2t1cCxsb2NhdG9yKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdFx0aWYoIWVsLmNsb3NlZCAmJiBmaXhTZWxmQ2xvc2VkKHNvdXJjZSxlbmQsZWwudGFnTmFtZSxjbG9zZU1hcCkpe1xyXG5cdFx0XHRcdFx0ZWwuY2xvc2VkID0gdHJ1ZTtcclxuXHRcdFx0XHRcdGlmKCFlbnRpdHlNYXAubmJzcCl7XHJcblx0XHRcdFx0XHRcdGVycm9ySGFuZGxlci53YXJuaW5nKCd1bmNsb3NlZCB4bWwgYXR0cmlidXRlJyk7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGFwcGVuZEVsZW1lbnQoZWwsZG9tQnVpbGRlcixwYXJzZVN0YWNrKTtcclxuXHRcdFx0XHRcclxuXHRcdFx0XHRcclxuXHRcdFx0XHRpZihlbC51cmkgPT09ICdodHRwOi8vd3d3LnczLm9yZy8xOTk5L3hodG1sJyAmJiAhZWwuY2xvc2VkKXtcclxuXHRcdFx0XHRcdGVuZCA9IHBhcnNlSHRtbFNwZWNpYWxDb250ZW50KHNvdXJjZSxlbmQsZWwudGFnTmFtZSxlbnRpdHlSZXBsYWNlcixkb21CdWlsZGVyKVxyXG5cdFx0XHRcdH1lbHNle1xyXG5cdFx0XHRcdFx0ZW5kKys7XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9Y2F0Y2goZSl7XHJcblx0XHRcdFx0ZXJyb3JIYW5kbGVyLmVycm9yKCdlbGVtZW50IHBhcnNlIGVycm9yOiAnK2UpO1xyXG5cdFx0XHRcdGVuZCA9IC0xO1xyXG5cdFx0XHR9XHJcblxyXG5cdFx0fVxyXG5cdFx0aWYoZW5kPDApe1xyXG5cdFx0XHQvL1RPRE86IOi/memHjOacieWPr+iDvXNheOWbnumAgO+8jOacieS9jee9rumUmeivr+mjjumZqVxyXG5cdFx0XHRhcHBlbmRUZXh0KGkrMSk7XHJcblx0XHR9ZWxzZXtcclxuXHRcdFx0c3RhcnQgPSBlbmQ7XHJcblx0XHR9XHJcblx0fVxyXG59XHJcbmZ1bmN0aW9uIGNvcHlMb2NhdG9yKGYsdCl7XHJcblx0dC5saW5lTnVtYmVyID0gZi5saW5lTnVtYmVyO1xyXG5cdHQuY29sdW1uTnVtYmVyID0gZi5jb2x1bW5OdW1iZXI7XHJcblx0cmV0dXJuIHQ7XHJcblx0XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBAc2VlICNhcHBlbmRFbGVtZW50KHNvdXJjZSxlbFN0YXJ0RW5kLGVsLHNlbGZDbG9zZWQsZW50aXR5UmVwbGFjZXIsZG9tQnVpbGRlcixwYXJzZVN0YWNrKTtcclxuICogQHJldHVybiBlbmQgb2YgdGhlIGVsZW1lbnRTdGFydFBhcnQoZW5kIG9mIGVsZW1lbnRFbmRQYXJ0IGZvciBzZWxmQ2xvc2VkIGVsKVxyXG4gKi9cclxuZnVuY3Rpb24gcGFyc2VFbGVtZW50U3RhcnRQYXJ0KHNvdXJjZSxzdGFydCxlbCxlbnRpdHlSZXBsYWNlcixlcnJvckhhbmRsZXIpe1xyXG5cdHZhciBhdHRyTmFtZTtcclxuXHR2YXIgdmFsdWU7XHJcblx0dmFyIHAgPSArK3N0YXJ0O1xyXG5cdHZhciBzID0gU19UQUc7Ly9zdGF0dXNcclxuXHR3aGlsZSh0cnVlKXtcclxuXHRcdHZhciBjID0gc291cmNlLmNoYXJBdChwKTtcclxuXHRcdHN3aXRjaChjKXtcclxuXHRcdGNhc2UgJz0nOlxyXG5cdFx0XHRpZihzID09PSBTX0FUVFIpey8vYXR0ck5hbWVcclxuXHRcdFx0XHRhdHRyTmFtZSA9IHNvdXJjZS5zbGljZShzdGFydCxwKTtcclxuXHRcdFx0XHRzID0gU19FUTtcclxuXHRcdFx0fWVsc2UgaWYocyA9PT0gU19BVFRSX1Mpe1xyXG5cdFx0XHRcdHMgPSBTX0VRO1xyXG5cdFx0XHR9ZWxzZXtcclxuXHRcdFx0XHQvL2ZhdGFsRXJyb3I6IGVxdWFsIG11c3QgYWZ0ZXIgYXR0ck5hbWUgb3Igc3BhY2UgYWZ0ZXIgYXR0ck5hbWVcclxuXHRcdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ2F0dHJpYnV0ZSBlcXVhbCBtdXN0IGFmdGVyIGF0dHJOYW1lJyk7XHJcblx0XHRcdH1cclxuXHRcdFx0YnJlYWs7XHJcblx0XHRjYXNlICdcXCcnOlxyXG5cdFx0Y2FzZSAnXCInOlxyXG5cdFx0XHRpZihzID09PSBTX0VRKXsvL2VxdWFsXHJcblx0XHRcdFx0c3RhcnQgPSBwKzE7XHJcblx0XHRcdFx0cCA9IHNvdXJjZS5pbmRleE9mKGMsc3RhcnQpXHJcblx0XHRcdFx0aWYocD4wKXtcclxuXHRcdFx0XHRcdHZhbHVlID0gc291cmNlLnNsaWNlKHN0YXJ0LHApLnJlcGxhY2UoLyYjP1xcdys7L2csZW50aXR5UmVwbGFjZXIpO1xyXG5cdFx0XHRcdFx0ZWwuYWRkKGF0dHJOYW1lLHZhbHVlLHN0YXJ0LTEpO1xyXG5cdFx0XHRcdFx0cyA9IFNfRTtcclxuXHRcdFx0XHR9ZWxzZXtcclxuXHRcdFx0XHRcdC8vZmF0YWxFcnJvcjogbm8gZW5kIHF1b3QgbWF0Y2hcclxuXHRcdFx0XHRcdHRocm93IG5ldyBFcnJvcignYXR0cmlidXRlIHZhbHVlIG5vIGVuZCBcXCcnK2MrJ1xcJyBtYXRjaCcpO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0fWVsc2UgaWYocyA9PSBTX1Ype1xyXG5cdFx0XHRcdHZhbHVlID0gc291cmNlLnNsaWNlKHN0YXJ0LHApLnJlcGxhY2UoLyYjP1xcdys7L2csZW50aXR5UmVwbGFjZXIpO1xyXG5cdFx0XHRcdC8vY29uc29sZS5sb2coYXR0ck5hbWUsdmFsdWUsc3RhcnQscClcclxuXHRcdFx0XHRlbC5hZGQoYXR0ck5hbWUsdmFsdWUsc3RhcnQpO1xyXG5cdFx0XHRcdC8vY29uc29sZS5kaXIoZWwpXHJcblx0XHRcdFx0ZXJyb3JIYW5kbGVyLndhcm5pbmcoJ2F0dHJpYnV0ZSBcIicrYXR0ck5hbWUrJ1wiIG1pc3NlZCBzdGFydCBxdW90KCcrYysnKSEhJyk7XHJcblx0XHRcdFx0c3RhcnQgPSBwKzE7XHJcblx0XHRcdFx0cyA9IFNfRVxyXG5cdFx0XHR9ZWxzZXtcclxuXHRcdFx0XHQvL2ZhdGFsRXJyb3I6IG5vIGVxdWFsIGJlZm9yZVxyXG5cdFx0XHRcdHRocm93IG5ldyBFcnJvcignYXR0cmlidXRlIHZhbHVlIG11c3QgYWZ0ZXIgXCI9XCInKTtcclxuXHRcdFx0fVxyXG5cdFx0XHRicmVhaztcclxuXHRcdGNhc2UgJy8nOlxyXG5cdFx0XHRzd2l0Y2gocyl7XHJcblx0XHRcdGNhc2UgU19UQUc6XHJcblx0XHRcdFx0ZWwuc2V0VGFnTmFtZShzb3VyY2Uuc2xpY2Uoc3RhcnQscCkpO1xyXG5cdFx0XHRjYXNlIFNfRTpcclxuXHRcdFx0Y2FzZSBTX1M6XHJcblx0XHRcdGNhc2UgU19DOlxyXG5cdFx0XHRcdHMgPSBTX0M7XHJcblx0XHRcdFx0ZWwuY2xvc2VkID0gdHJ1ZTtcclxuXHRcdFx0Y2FzZSBTX1Y6XHJcblx0XHRcdGNhc2UgU19BVFRSOlxyXG5cdFx0XHRjYXNlIFNfQVRUUl9TOlxyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHQvL2Nhc2UgU19FUTpcclxuXHRcdFx0ZGVmYXVsdDpcclxuXHRcdFx0XHR0aHJvdyBuZXcgRXJyb3IoXCJhdHRyaWJ1dGUgaW52YWxpZCBjbG9zZSBjaGFyKCcvJylcIilcclxuXHRcdFx0fVxyXG5cdFx0XHRicmVhaztcclxuXHRcdGNhc2UgJyc6Ly9lbmQgZG9jdW1lbnRcclxuXHRcdFx0Ly90aHJvdyBuZXcgRXJyb3IoJ3VuZXhwZWN0ZWQgZW5kIG9mIGlucHV0JylcclxuXHRcdFx0ZXJyb3JIYW5kbGVyLmVycm9yKCd1bmV4cGVjdGVkIGVuZCBvZiBpbnB1dCcpO1xyXG5cdFx0Y2FzZSAnPic6XHJcblx0XHRcdHN3aXRjaChzKXtcclxuXHRcdFx0Y2FzZSBTX1RBRzpcclxuXHRcdFx0XHRlbC5zZXRUYWdOYW1lKHNvdXJjZS5zbGljZShzdGFydCxwKSk7XHJcblx0XHRcdGNhc2UgU19FOlxyXG5cdFx0XHRjYXNlIFNfUzpcclxuXHRcdFx0Y2FzZSBTX0M6XHJcblx0XHRcdFx0YnJlYWs7Ly9ub3JtYWxcclxuXHRcdFx0Y2FzZSBTX1Y6Ly9Db21wYXRpYmxlIHN0YXRlXHJcblx0XHRcdGNhc2UgU19BVFRSOlxyXG5cdFx0XHRcdHZhbHVlID0gc291cmNlLnNsaWNlKHN0YXJ0LHApO1xyXG5cdFx0XHRcdGlmKHZhbHVlLnNsaWNlKC0xKSA9PT0gJy8nKXtcclxuXHRcdFx0XHRcdGVsLmNsb3NlZCAgPSB0cnVlO1xyXG5cdFx0XHRcdFx0dmFsdWUgPSB2YWx1ZS5zbGljZSgwLC0xKVxyXG5cdFx0XHRcdH1cclxuXHRcdFx0Y2FzZSBTX0FUVFJfUzpcclxuXHRcdFx0XHRpZihzID09PSBTX0FUVFJfUyl7XHJcblx0XHRcdFx0XHR2YWx1ZSA9IGF0dHJOYW1lO1xyXG5cdFx0XHRcdH1cclxuXHRcdFx0XHRpZihzID09IFNfVil7XHJcblx0XHRcdFx0XHRlcnJvckhhbmRsZXIud2FybmluZygnYXR0cmlidXRlIFwiJyt2YWx1ZSsnXCIgbWlzc2VkIHF1b3QoXCIpISEnKTtcclxuXHRcdFx0XHRcdGVsLmFkZChhdHRyTmFtZSx2YWx1ZS5yZXBsYWNlKC8mIz9cXHcrOy9nLGVudGl0eVJlcGxhY2VyKSxzdGFydClcclxuXHRcdFx0XHR9ZWxzZXtcclxuXHRcdFx0XHRcdGVycm9ySGFuZGxlci53YXJuaW5nKCdhdHRyaWJ1dGUgXCInK3ZhbHVlKydcIiBtaXNzZWQgdmFsdWUhISBcIicrdmFsdWUrJ1wiIGluc3RlYWQhIScpXHJcblx0XHRcdFx0XHRlbC5hZGQodmFsdWUsdmFsdWUsc3RhcnQpXHJcblx0XHRcdFx0fVxyXG5cdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRjYXNlIFNfRVE6XHJcblx0XHRcdFx0dGhyb3cgbmV3IEVycm9yKCdhdHRyaWJ1dGUgdmFsdWUgbWlzc2VkISEnKTtcclxuXHRcdFx0fVxyXG4vL1x0XHRcdGNvbnNvbGUubG9nKHRhZ05hbWUsdGFnTmFtZVBhdHRlcm4sdGFnTmFtZVBhdHRlcm4udGVzdCh0YWdOYW1lKSlcclxuXHRcdFx0cmV0dXJuIHA7XHJcblx0XHQvKnhtbCBzcGFjZSAnXFx4MjAnIHwgI3g5IHwgI3hEIHwgI3hBOyAqL1xyXG5cdFx0Y2FzZSAnXFx1MDA4MCc6XHJcblx0XHRcdGMgPSAnICc7XHJcblx0XHRkZWZhdWx0OlxyXG5cdFx0XHRpZihjPD0gJyAnKXsvL3NwYWNlXHJcblx0XHRcdFx0c3dpdGNoKHMpe1xyXG5cdFx0XHRcdGNhc2UgU19UQUc6XHJcblx0XHRcdFx0XHRlbC5zZXRUYWdOYW1lKHNvdXJjZS5zbGljZShzdGFydCxwKSk7Ly90YWdOYW1lXHJcblx0XHRcdFx0XHRzID0gU19TO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0Y2FzZSBTX0FUVFI6XHJcblx0XHRcdFx0XHRhdHRyTmFtZSA9IHNvdXJjZS5zbGljZShzdGFydCxwKVxyXG5cdFx0XHRcdFx0cyA9IFNfQVRUUl9TO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0Y2FzZSBTX1Y6XHJcblx0XHRcdFx0XHR2YXIgdmFsdWUgPSBzb3VyY2Uuc2xpY2Uoc3RhcnQscCkucmVwbGFjZSgvJiM/XFx3KzsvZyxlbnRpdHlSZXBsYWNlcik7XHJcblx0XHRcdFx0XHRlcnJvckhhbmRsZXIud2FybmluZygnYXR0cmlidXRlIFwiJyt2YWx1ZSsnXCIgbWlzc2VkIHF1b3QoXCIpISEnKTtcclxuXHRcdFx0XHRcdGVsLmFkZChhdHRyTmFtZSx2YWx1ZSxzdGFydClcclxuXHRcdFx0XHRjYXNlIFNfRTpcclxuXHRcdFx0XHRcdHMgPSBTX1M7XHJcblx0XHRcdFx0XHRicmVhaztcclxuXHRcdFx0XHQvL2Nhc2UgU19TOlxyXG5cdFx0XHRcdC8vY2FzZSBTX0VROlxyXG5cdFx0XHRcdC8vY2FzZSBTX0FUVFJfUzpcclxuXHRcdFx0XHQvL1x0dm9pZCgpO2JyZWFrO1xyXG5cdFx0XHRcdC8vY2FzZSBTX0M6XHJcblx0XHRcdFx0XHQvL2lnbm9yZSB3YXJuaW5nXHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9ZWxzZXsvL25vdCBzcGFjZVxyXG4vL1NfVEFHLFx0U19BVFRSLFx0U19FUSxcdFNfVlxyXG4vL1NfQVRUUl9TLFx0U19FLFx0U19TLFx0U19DXHJcblx0XHRcdFx0c3dpdGNoKHMpe1xyXG5cdFx0XHRcdC8vY2FzZSBTX1RBRzp2b2lkKCk7YnJlYWs7XHJcblx0XHRcdFx0Ly9jYXNlIFNfQVRUUjp2b2lkKCk7YnJlYWs7XHJcblx0XHRcdFx0Ly9jYXNlIFNfVjp2b2lkKCk7YnJlYWs7XHJcblx0XHRcdFx0Y2FzZSBTX0FUVFJfUzpcclxuXHRcdFx0XHRcdGVycm9ySGFuZGxlci53YXJuaW5nKCdhdHRyaWJ1dGUgXCInK2F0dHJOYW1lKydcIiBtaXNzZWQgdmFsdWUhISBcIicrYXR0ck5hbWUrJ1wiIGluc3RlYWQhIScpXHJcblx0XHRcdFx0XHRlbC5hZGQoYXR0ck5hbWUsYXR0ck5hbWUsc3RhcnQpO1xyXG5cdFx0XHRcdFx0c3RhcnQgPSBwO1xyXG5cdFx0XHRcdFx0cyA9IFNfQVRUUjtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdGNhc2UgU19FOlxyXG5cdFx0XHRcdFx0ZXJyb3JIYW5kbGVyLndhcm5pbmcoJ2F0dHJpYnV0ZSBzcGFjZSBpcyByZXF1aXJlZFwiJythdHRyTmFtZSsnXCIhIScpXHJcblx0XHRcdFx0Y2FzZSBTX1M6XHJcblx0XHRcdFx0XHRzID0gU19BVFRSO1xyXG5cdFx0XHRcdFx0c3RhcnQgPSBwO1xyXG5cdFx0XHRcdFx0YnJlYWs7XHJcblx0XHRcdFx0Y2FzZSBTX0VROlxyXG5cdFx0XHRcdFx0cyA9IFNfVjtcclxuXHRcdFx0XHRcdHN0YXJ0ID0gcDtcclxuXHRcdFx0XHRcdGJyZWFrO1xyXG5cdFx0XHRcdGNhc2UgU19DOlxyXG5cdFx0XHRcdFx0dGhyb3cgbmV3IEVycm9yKFwiZWxlbWVudHMgY2xvc2VkIGNoYXJhY3RlciAnLycgYW5kICc+JyBtdXN0IGJlIGNvbm5lY3RlZCB0b1wiKTtcclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHArKztcclxuXHR9XHJcbn1cclxuLyoqXHJcbiAqIEByZXR1cm4gZW5kIG9mIHRoZSBlbGVtZW50U3RhcnRQYXJ0KGVuZCBvZiBlbGVtZW50RW5kUGFydCBmb3Igc2VsZkNsb3NlZCBlbClcclxuICovXHJcbmZ1bmN0aW9uIGFwcGVuZEVsZW1lbnQoZWwsZG9tQnVpbGRlcixwYXJzZVN0YWNrKXtcclxuXHR2YXIgdGFnTmFtZSA9IGVsLnRhZ05hbWU7XHJcblx0dmFyIGxvY2FsTlNNYXAgPSBudWxsO1xyXG5cdHZhciBjdXJyZW50TlNNYXAgPSBwYXJzZVN0YWNrW3BhcnNlU3RhY2subGVuZ3RoLTFdLmN1cnJlbnROU01hcDtcclxuXHR2YXIgaSA9IGVsLmxlbmd0aDtcclxuXHR3aGlsZShpLS0pe1xyXG5cdFx0dmFyIGEgPSBlbFtpXTtcclxuXHRcdHZhciBxTmFtZSA9IGEucU5hbWU7XHJcblx0XHR2YXIgdmFsdWUgPSBhLnZhbHVlO1xyXG5cdFx0dmFyIG5zcCA9IHFOYW1lLmluZGV4T2YoJzonKTtcclxuXHRcdGlmKG5zcD4wKXtcclxuXHRcdFx0dmFyIHByZWZpeCA9IGEucHJlZml4ID0gcU5hbWUuc2xpY2UoMCxuc3ApO1xyXG5cdFx0XHR2YXIgbG9jYWxOYW1lID0gcU5hbWUuc2xpY2UobnNwKzEpO1xyXG5cdFx0XHR2YXIgbnNQcmVmaXggPSBwcmVmaXggPT09ICd4bWxucycgJiYgbG9jYWxOYW1lXHJcblx0XHR9ZWxzZXtcclxuXHRcdFx0bG9jYWxOYW1lID0gcU5hbWU7XHJcblx0XHRcdHByZWZpeCA9IG51bGxcclxuXHRcdFx0bnNQcmVmaXggPSBxTmFtZSA9PT0gJ3htbG5zJyAmJiAnJ1xyXG5cdFx0fVxyXG5cdFx0Ly9jYW4gbm90IHNldCBwcmVmaXgsYmVjYXVzZSBwcmVmaXggIT09ICcnXHJcblx0XHRhLmxvY2FsTmFtZSA9IGxvY2FsTmFtZSA7XHJcblx0XHQvL3ByZWZpeCA9PSBudWxsIGZvciBubyBucyBwcmVmaXggYXR0cmlidXRlIFxyXG5cdFx0aWYobnNQcmVmaXggIT09IGZhbHNlKXsvL2hhY2shIVxyXG5cdFx0XHRpZihsb2NhbE5TTWFwID09IG51bGwpe1xyXG5cdFx0XHRcdGxvY2FsTlNNYXAgPSB7fVxyXG5cdFx0XHRcdC8vY29uc29sZS5sb2coY3VycmVudE5TTWFwLDApXHJcblx0XHRcdFx0X2NvcHkoY3VycmVudE5TTWFwLGN1cnJlbnROU01hcD17fSlcclxuXHRcdFx0XHQvL2NvbnNvbGUubG9nKGN1cnJlbnROU01hcCwxKVxyXG5cdFx0XHR9XHJcblx0XHRcdGN1cnJlbnROU01hcFtuc1ByZWZpeF0gPSBsb2NhbE5TTWFwW25zUHJlZml4XSA9IHZhbHVlO1xyXG5cdFx0XHRhLnVyaSA9ICdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3htbG5zLydcclxuXHRcdFx0ZG9tQnVpbGRlci5zdGFydFByZWZpeE1hcHBpbmcobnNQcmVmaXgsIHZhbHVlKSBcclxuXHRcdH1cclxuXHR9XHJcblx0dmFyIGkgPSBlbC5sZW5ndGg7XHJcblx0d2hpbGUoaS0tKXtcclxuXHRcdGEgPSBlbFtpXTtcclxuXHRcdHZhciBwcmVmaXggPSBhLnByZWZpeDtcclxuXHRcdGlmKHByZWZpeCl7Ly9ubyBwcmVmaXggYXR0cmlidXRlIGhhcyBubyBuYW1lc3BhY2VcclxuXHRcdFx0aWYocHJlZml4ID09PSAneG1sJyl7XHJcblx0XHRcdFx0YS51cmkgPSAnaHR0cDovL3d3dy53My5vcmcvWE1MLzE5OTgvbmFtZXNwYWNlJztcclxuXHRcdFx0fWlmKHByZWZpeCAhPT0gJ3htbG5zJyl7XHJcblx0XHRcdFx0YS51cmkgPSBjdXJyZW50TlNNYXBbcHJlZml4XVxyXG5cdFx0XHRcdFxyXG5cdFx0XHRcdC8ve2NvbnNvbGUubG9nKCcjIyMnK2EucU5hbWUsZG9tQnVpbGRlci5sb2NhdG9yLnN5c3RlbUlkKycnLGN1cnJlbnROU01hcCxhLnVyaSl9XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHR9XHJcblx0dmFyIG5zcCA9IHRhZ05hbWUuaW5kZXhPZignOicpO1xyXG5cdGlmKG5zcD4wKXtcclxuXHRcdHByZWZpeCA9IGVsLnByZWZpeCA9IHRhZ05hbWUuc2xpY2UoMCxuc3ApO1xyXG5cdFx0bG9jYWxOYW1lID0gZWwubG9jYWxOYW1lID0gdGFnTmFtZS5zbGljZShuc3ArMSk7XHJcblx0fWVsc2V7XHJcblx0XHRwcmVmaXggPSBudWxsOy8vaW1wb3J0YW50ISFcclxuXHRcdGxvY2FsTmFtZSA9IGVsLmxvY2FsTmFtZSA9IHRhZ05hbWU7XHJcblx0fVxyXG5cdC8vbm8gcHJlZml4IGVsZW1lbnQgaGFzIGRlZmF1bHQgbmFtZXNwYWNlXHJcblx0dmFyIG5zID0gZWwudXJpID0gY3VycmVudE5TTWFwW3ByZWZpeCB8fCAnJ107XHJcblx0ZG9tQnVpbGRlci5zdGFydEVsZW1lbnQobnMsbG9jYWxOYW1lLHRhZ05hbWUsZWwpO1xyXG5cdC8vZW5kUHJlZml4TWFwcGluZyBhbmQgc3RhcnRQcmVmaXhNYXBwaW5nIGhhdmUgbm90IGFueSBoZWxwIGZvciBkb20gYnVpbGRlclxyXG5cdC8vbG9jYWxOU01hcCA9IG51bGxcclxuXHRpZihlbC5jbG9zZWQpe1xyXG5cdFx0ZG9tQnVpbGRlci5lbmRFbGVtZW50KG5zLGxvY2FsTmFtZSx0YWdOYW1lKTtcclxuXHRcdGlmKGxvY2FsTlNNYXApe1xyXG5cdFx0XHRmb3IocHJlZml4IGluIGxvY2FsTlNNYXApe1xyXG5cdFx0XHRcdGRvbUJ1aWxkZXIuZW5kUHJlZml4TWFwcGluZyhwcmVmaXgpIFxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0fWVsc2V7XHJcblx0XHRlbC5jdXJyZW50TlNNYXAgPSBjdXJyZW50TlNNYXA7XHJcblx0XHRlbC5sb2NhbE5TTWFwID0gbG9jYWxOU01hcDtcclxuXHRcdHBhcnNlU3RhY2sucHVzaChlbCk7XHJcblx0fVxyXG59XHJcbmZ1bmN0aW9uIHBhcnNlSHRtbFNwZWNpYWxDb250ZW50KHNvdXJjZSxlbFN0YXJ0RW5kLHRhZ05hbWUsZW50aXR5UmVwbGFjZXIsZG9tQnVpbGRlcil7XHJcblx0aWYoL14oPzpzY3JpcHR8dGV4dGFyZWEpJC9pLnRlc3QodGFnTmFtZSkpe1xyXG5cdFx0dmFyIGVsRW5kU3RhcnQgPSAgc291cmNlLmluZGV4T2YoJzwvJyt0YWdOYW1lKyc+JyxlbFN0YXJ0RW5kKTtcclxuXHRcdHZhciB0ZXh0ID0gc291cmNlLnN1YnN0cmluZyhlbFN0YXJ0RW5kKzEsZWxFbmRTdGFydCk7XHJcblx0XHRpZigvWyY8XS8udGVzdCh0ZXh0KSl7XHJcblx0XHRcdGlmKC9ec2NyaXB0JC9pLnRlc3QodGFnTmFtZSkpe1xyXG5cdFx0XHRcdC8vaWYoIS9cXF1cXF0+Ly50ZXN0KHRleHQpKXtcclxuXHRcdFx0XHRcdC8vbGV4SGFuZGxlci5zdGFydENEQVRBKCk7XHJcblx0XHRcdFx0XHRkb21CdWlsZGVyLmNoYXJhY3RlcnModGV4dCwwLHRleHQubGVuZ3RoKTtcclxuXHRcdFx0XHRcdC8vbGV4SGFuZGxlci5lbmRDREFUQSgpO1xyXG5cdFx0XHRcdFx0cmV0dXJuIGVsRW5kU3RhcnQ7XHJcblx0XHRcdFx0Ly99XHJcblx0XHRcdH0vL31lbHNley8vdGV4dCBhcmVhXHJcblx0XHRcdFx0dGV4dCA9IHRleHQucmVwbGFjZSgvJiM/XFx3KzsvZyxlbnRpdHlSZXBsYWNlcik7XHJcblx0XHRcdFx0ZG9tQnVpbGRlci5jaGFyYWN0ZXJzKHRleHQsMCx0ZXh0Lmxlbmd0aCk7XHJcblx0XHRcdFx0cmV0dXJuIGVsRW5kU3RhcnQ7XHJcblx0XHRcdC8vfVxyXG5cdFx0XHRcclxuXHRcdH1cclxuXHR9XHJcblx0cmV0dXJuIGVsU3RhcnRFbmQrMTtcclxufVxyXG5mdW5jdGlvbiBmaXhTZWxmQ2xvc2VkKHNvdXJjZSxlbFN0YXJ0RW5kLHRhZ05hbWUsY2xvc2VNYXApe1xyXG5cdC8vaWYodGFnTmFtZSBpbiBjbG9zZU1hcCl7XHJcblx0dmFyIHBvcyA9IGNsb3NlTWFwW3RhZ05hbWVdO1xyXG5cdGlmKHBvcyA9PSBudWxsKXtcclxuXHRcdC8vY29uc29sZS5sb2codGFnTmFtZSlcclxuXHRcdHBvcyA9IGNsb3NlTWFwW3RhZ05hbWVdID0gc291cmNlLmxhc3RJbmRleE9mKCc8LycrdGFnTmFtZSsnPicpXHJcblx0fVxyXG5cdHJldHVybiBwb3M8ZWxTdGFydEVuZDtcclxuXHQvL30gXHJcbn1cclxuZnVuY3Rpb24gX2NvcHkoc291cmNlLHRhcmdldCl7XHJcblx0Zm9yKHZhciBuIGluIHNvdXJjZSl7dGFyZ2V0W25dID0gc291cmNlW25dfVxyXG59XHJcbmZ1bmN0aW9uIHBhcnNlRENDKHNvdXJjZSxzdGFydCxkb21CdWlsZGVyLGVycm9ySGFuZGxlcil7Ly9zdXJlIHN0YXJ0IHdpdGggJzwhJ1xyXG5cdHZhciBuZXh0PSBzb3VyY2UuY2hhckF0KHN0YXJ0KzIpXHJcblx0c3dpdGNoKG5leHQpe1xyXG5cdGNhc2UgJy0nOlxyXG5cdFx0aWYoc291cmNlLmNoYXJBdChzdGFydCArIDMpID09PSAnLScpe1xyXG5cdFx0XHR2YXIgZW5kID0gc291cmNlLmluZGV4T2YoJy0tPicsc3RhcnQrNCk7XHJcblx0XHRcdC8vYXBwZW5kIGNvbW1lbnQgc291cmNlLnN1YnN0cmluZyg0LGVuZCkvLzwhLS1cclxuXHRcdFx0aWYoZW5kPnN0YXJ0KXtcclxuXHRcdFx0XHRkb21CdWlsZGVyLmNvbW1lbnQoc291cmNlLHN0YXJ0KzQsZW5kLXN0YXJ0LTQpO1xyXG5cdFx0XHRcdHJldHVybiBlbmQrMztcclxuXHRcdFx0fWVsc2V7XHJcblx0XHRcdFx0ZXJyb3JIYW5kbGVyLmVycm9yKFwiVW5jbG9zZWQgY29tbWVudFwiKTtcclxuXHRcdFx0XHRyZXR1cm4gLTE7XHJcblx0XHRcdH1cclxuXHRcdH1lbHNle1xyXG5cdFx0XHQvL2Vycm9yXHJcblx0XHRcdHJldHVybiAtMTtcclxuXHRcdH1cclxuXHRkZWZhdWx0OlxyXG5cdFx0aWYoc291cmNlLnN1YnN0cihzdGFydCszLDYpID09ICdDREFUQVsnKXtcclxuXHRcdFx0dmFyIGVuZCA9IHNvdXJjZS5pbmRleE9mKCddXT4nLHN0YXJ0KzkpO1xyXG5cdFx0XHRkb21CdWlsZGVyLnN0YXJ0Q0RBVEEoKTtcclxuXHRcdFx0ZG9tQnVpbGRlci5jaGFyYWN0ZXJzKHNvdXJjZSxzdGFydCs5LGVuZC1zdGFydC05KTtcclxuXHRcdFx0ZG9tQnVpbGRlci5lbmRDREFUQSgpIFxyXG5cdFx0XHRyZXR1cm4gZW5kKzM7XHJcblx0XHR9XHJcblx0XHQvLzwhRE9DVFlQRVxyXG5cdFx0Ly9zdGFydERURChqYXZhLmxhbmcuU3RyaW5nIG5hbWUsIGphdmEubGFuZy5TdHJpbmcgcHVibGljSWQsIGphdmEubGFuZy5TdHJpbmcgc3lzdGVtSWQpIFxyXG5cdFx0dmFyIG1hdGNocyA9IHNwbGl0KHNvdXJjZSxzdGFydCk7XHJcblx0XHR2YXIgbGVuID0gbWF0Y2hzLmxlbmd0aDtcclxuXHRcdGlmKGxlbj4xICYmIC8hZG9jdHlwZS9pLnRlc3QobWF0Y2hzWzBdWzBdKSl7XHJcblx0XHRcdHZhciBuYW1lID0gbWF0Y2hzWzFdWzBdO1xyXG5cdFx0XHR2YXIgcHViaWQgPSBsZW4+MyAmJiAvXnB1YmxpYyQvaS50ZXN0KG1hdGNoc1syXVswXSkgJiYgbWF0Y2hzWzNdWzBdXHJcblx0XHRcdHZhciBzeXNpZCA9IGxlbj40ICYmIG1hdGNoc1s0XVswXTtcclxuXHRcdFx0dmFyIGxhc3RNYXRjaCA9IG1hdGNoc1tsZW4tMV1cclxuXHRcdFx0ZG9tQnVpbGRlci5zdGFydERURChuYW1lLHB1YmlkICYmIHB1YmlkLnJlcGxhY2UoL14oWydcIl0pKC4qPylcXDEkLywnJDInKSxcclxuXHRcdFx0XHRcdHN5c2lkICYmIHN5c2lkLnJlcGxhY2UoL14oWydcIl0pKC4qPylcXDEkLywnJDInKSk7XHJcblx0XHRcdGRvbUJ1aWxkZXIuZW5kRFREKCk7XHJcblx0XHRcdFxyXG5cdFx0XHRyZXR1cm4gbGFzdE1hdGNoLmluZGV4K2xhc3RNYXRjaFswXS5sZW5ndGhcclxuXHRcdH1cclxuXHR9XHJcblx0cmV0dXJuIC0xO1xyXG59XHJcblxyXG5cclxuXHJcbmZ1bmN0aW9uIHBhcnNlSW5zdHJ1Y3Rpb24oc291cmNlLHN0YXJ0LGRvbUJ1aWxkZXIpe1xyXG5cdHZhciBlbmQgPSBzb3VyY2UuaW5kZXhPZignPz4nLHN0YXJ0KTtcclxuXHRpZihlbmQpe1xyXG5cdFx0dmFyIG1hdGNoID0gc291cmNlLnN1YnN0cmluZyhzdGFydCxlbmQpLm1hdGNoKC9ePFxcPyhcXFMqKVxccyooW1xcc1xcU10qPylcXHMqJC8pO1xyXG5cdFx0aWYobWF0Y2gpe1xyXG5cdFx0XHR2YXIgbGVuID0gbWF0Y2hbMF0ubGVuZ3RoO1xyXG5cdFx0XHRkb21CdWlsZGVyLnByb2Nlc3NpbmdJbnN0cnVjdGlvbihtYXRjaFsxXSwgbWF0Y2hbMl0pIDtcclxuXHRcdFx0cmV0dXJuIGVuZCsyO1xyXG5cdFx0fWVsc2V7Ly9lcnJvclxyXG5cdFx0XHRyZXR1cm4gLTE7XHJcblx0XHR9XHJcblx0fVxyXG5cdHJldHVybiAtMTtcclxufVxyXG5cclxuLyoqXHJcbiAqIEBwYXJhbSBzb3VyY2VcclxuICovXHJcbmZ1bmN0aW9uIEVsZW1lbnRBdHRyaWJ1dGVzKHNvdXJjZSl7XHJcblx0XHJcbn1cclxuRWxlbWVudEF0dHJpYnV0ZXMucHJvdG90eXBlID0ge1xyXG5cdHNldFRhZ05hbWU6ZnVuY3Rpb24odGFnTmFtZSl7XHJcblx0XHRpZighdGFnTmFtZVBhdHRlcm4udGVzdCh0YWdOYW1lKSl7XHJcblx0XHRcdHRocm93IG5ldyBFcnJvcignaW52YWxpZCB0YWdOYW1lOicrdGFnTmFtZSlcclxuXHRcdH1cclxuXHRcdHRoaXMudGFnTmFtZSA9IHRhZ05hbWVcclxuXHR9LFxyXG5cdGFkZDpmdW5jdGlvbihxTmFtZSx2YWx1ZSxvZmZzZXQpe1xyXG5cdFx0aWYoIXRhZ05hbWVQYXR0ZXJuLnRlc3QocU5hbWUpKXtcclxuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdpbnZhbGlkIGF0dHJpYnV0ZTonK3FOYW1lKVxyXG5cdFx0fVxyXG5cdFx0dGhpc1t0aGlzLmxlbmd0aCsrXSA9IHtxTmFtZTpxTmFtZSx2YWx1ZTp2YWx1ZSxvZmZzZXQ6b2Zmc2V0fVxyXG5cdH0sXHJcblx0bGVuZ3RoOjAsXHJcblx0Z2V0TG9jYWxOYW1lOmZ1bmN0aW9uKGkpe3JldHVybiB0aGlzW2ldLmxvY2FsTmFtZX0sXHJcblx0Z2V0T2Zmc2V0OmZ1bmN0aW9uKGkpe3JldHVybiB0aGlzW2ldLm9mZnNldH0sXHJcblx0Z2V0UU5hbWU6ZnVuY3Rpb24oaSl7cmV0dXJuIHRoaXNbaV0ucU5hbWV9LFxyXG5cdGdldFVSSTpmdW5jdGlvbihpKXtyZXR1cm4gdGhpc1tpXS51cml9LFxyXG5cdGdldFZhbHVlOmZ1bmN0aW9uKGkpe3JldHVybiB0aGlzW2ldLnZhbHVlfVxyXG4vL1x0LGdldEluZGV4OmZ1bmN0aW9uKHVyaSwgbG9jYWxOYW1lKSl7XHJcbi8vXHRcdGlmKGxvY2FsTmFtZSl7XHJcbi8vXHRcdFx0XHJcbi8vXHRcdH1lbHNle1xyXG4vL1x0XHRcdHZhciBxTmFtZSA9IHVyaVxyXG4vL1x0XHR9XHJcbi8vXHR9LFxyXG4vL1x0Z2V0VmFsdWU6ZnVuY3Rpb24oKXtyZXR1cm4gdGhpcy5nZXRWYWx1ZSh0aGlzLmdldEluZGV4LmFwcGx5KHRoaXMsYXJndW1lbnRzKSl9LFxyXG4vL1x0Z2V0VHlwZTpmdW5jdGlvbih1cmksbG9jYWxOYW1lKXt9XHJcbi8vXHRnZXRUeXBlOmZ1bmN0aW9uKGkpe30sXHJcbn1cclxuXHJcblxyXG5cclxuXHJcbmZ1bmN0aW9uIF9zZXRfcHJvdG9fKHRoaXoscGFyZW50KXtcclxuXHR0aGl6Ll9fcHJvdG9fXyA9IHBhcmVudDtcclxuXHRyZXR1cm4gdGhpejtcclxufVxyXG5pZighKF9zZXRfcHJvdG9fKHt9LF9zZXRfcHJvdG9fLnByb3RvdHlwZSkgaW5zdGFuY2VvZiBfc2V0X3Byb3RvXykpe1xyXG5cdF9zZXRfcHJvdG9fID0gZnVuY3Rpb24odGhpeixwYXJlbnQpe1xyXG5cdFx0ZnVuY3Rpb24gcCgpe307XHJcblx0XHRwLnByb3RvdHlwZSA9IHBhcmVudDtcclxuXHRcdHAgPSBuZXcgcCgpO1xyXG5cdFx0Zm9yKHBhcmVudCBpbiB0aGl6KXtcclxuXHRcdFx0cFtwYXJlbnRdID0gdGhpeltwYXJlbnRdO1xyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIHA7XHJcblx0fVxyXG59XHJcblxyXG5mdW5jdGlvbiBzcGxpdChzb3VyY2Usc3RhcnQpe1xyXG5cdHZhciBtYXRjaDtcclxuXHR2YXIgYnVmID0gW107XHJcblx0dmFyIHJlZyA9IC8nW14nXSsnfFwiW15cIl0rXCJ8W15cXHM8PlxcLz1dKz0/fChcXC8/XFxzKj58PCkvZztcclxuXHRyZWcubGFzdEluZGV4ID0gc3RhcnQ7XHJcblx0cmVnLmV4ZWMoc291cmNlKTsvL3NraXAgPFxyXG5cdHdoaWxlKG1hdGNoID0gcmVnLmV4ZWMoc291cmNlKSl7XHJcblx0XHRidWYucHVzaChtYXRjaCk7XHJcblx0XHRpZihtYXRjaFsxXSlyZXR1cm4gYnVmO1xyXG5cdH1cclxufVxyXG5cclxuaWYodHlwZW9mIHJlcXVpcmUgPT0gJ2Z1bmN0aW9uJyl7XHJcblx0ZXhwb3J0cy5YTUxSZWFkZXIgPSBYTUxSZWFkZXI7XHJcbn1cclxuXHJcblxufSkuY2FsbCh0aGlzLHJlcXVpcmUoXCJWQ21Fc3dcIiksdHlwZW9mIHNlbGYgIT09IFwidW5kZWZpbmVkXCIgPyBzZWxmIDogdHlwZW9mIHdpbmRvdyAhPT0gXCJ1bmRlZmluZWRcIiA/IHdpbmRvdyA6IHt9LHJlcXVpcmUoXCJidWZmZXJcIikuQnVmZmVyLGFyZ3VtZW50c1szXSxhcmd1bWVudHNbNF0sYXJndW1lbnRzWzVdLGFyZ3VtZW50c1s2XSxcIi8uLlxcXFxub2RlX21vZHVsZXNcXFxceG1sZG9tXFxcXHNheC5qc1wiLFwiLy4uXFxcXG5vZGVfbW9kdWxlc1xcXFx4bWxkb21cIikiLCIoZnVuY3Rpb24gKHByb2Nlc3MsZ2xvYmFsLEJ1ZmZlcixfX2FyZ3VtZW50MCxfX2FyZ3VtZW50MSxfX2FyZ3VtZW50MixfX2FyZ3VtZW50MyxfX2ZpbGVuYW1lLF9fZGlybmFtZSl7XG4vKipcbiAqIEdQWOODleOCoeOCpOODq+aTjeS9nOOBruODmuODvOOCuOeUqOOBrkphdmFTY3JpcHRcbiAqIEBjb3B5cmlnaHQgMjAxNSBZdVRhbmFrYVxuICogQGxpY2Vuc2UgTUlUXG4gKi9cblxudmFyIGdweHRyaW0gPSByZXF1aXJlKCcuL2dweC10cmltbWVyJyk7XG52YXIgc3RyR1BYID0gXCJcIjtcbnZhciBmaWxlR1BYID0gXCJcIjtcbnZhciByYW5nZUdQWCA9IHt9O1xuXG4vLyDjgqTjg5njg7Pjg4joqK3lrppcbiQoJyNmaWxlR3B4JykuY2hhbmdlKGNoYW5nZUZpbGUpO1xuJCgnc3VibWl0JykuY2xpY2soc3VibWl0R3B4KTtcblxuLyoqIFNVQk1JVOODnOOCv+ODsyovXG5mdW5jdGlvbiBzdWJtaXRHcHgoKSB7XG4gIHZhciByZXN1bHQ7XG5cbiAgaWYgKHN0ckdQWC5sZW5ndGggPT09IDApIHtcbiAgICBhbGVydCgnR1BY44OV44Kh44Kk44Or44KS6YG45oqe44GX44Gm44GP44Gg44GV44GE44CCJyk7XG4gICAgcmV0dXJuIDtcbiAgfVxuXG4gIC8vIOWkieaPm1xuICB2YXIgZHRzdCA9IERhdGUucGFyc2UoJCgnI3RleHRTdGFydCcpLnZhbCgpKTtcbiAgdmFyIGR0ZWQgPSBEYXRlLnBhcnNlKCQoJyN0ZXh0RW5kJykudmFsKCkpO1xuXG4gIC8vIOepuuashFxuICBpZiAoaXNOYU4oZHRzdCkpIHtcbiAgICBkdHN0ID0gcmFuZ2VHUFguZmlyc3QuZ2V0VGltZSgpO1xuICB9XG4gIGlmIChpc05hTihkdGVkKSkge1xuICAgIGR0ZWQgPSByYW5nZUdQWC5sYXN0LmdldFRpbWUoKTtcbiAgfVxuICAvLyDlhaXjgozmm7/jgYjjg4Hjgqfjg4Pjgq9cbiAgaWYgKGR0c3QgPiBkdGVkKSB7XG4gICAgYWxlcnQoXCLplovlp4vml6XmmYLjga7mlrnjgYzjgIHntYLkuobml6XmmYLjgojjgorlvozjga7mmYLplpPjgavjgarjgaPjgabjgYTjgb7jgZnjgIJcIik7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIOmWi+Wni+aZgumWk+OBjEdQWOOCiOOCiumBheOBhFxuICBpZiAoZHRzdCA+IHJhbmdlR1BYLmxhc3QuZ2V0VGltZSgpKSB7XG4gICAgYWxlcnQoXCLplovlp4vml6XmmYLjgYxHUFjjga7mmYLplpPjgpLpgY7jgY7jgabjgYTjgb7jgZnjgIJcIik7XG4gICAgcmV0dXJuO1xuICB9XG4gIC8vIOe1guS6huaZgumWk+OBjEdQWOOCiOOCiuaXqeOBhFxuICBpZiAoZHRlZCA8IHJhbmdlR1BYLmZpcnN0LmdldFRpbWUoKSkge1xuICAgIGFsZXJ0KCfntYLkuobml6XmmYLjgYxHUFjjga7plovlp4vmmYLplpPjgojjgorml6njgY/jgarjgaPjgabjgYTjgb7jgZnjgIInKTtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyDlpInmj5vlrp/ooYxcbiAgcmVzdWx0ID0gZ3B4dHJpbS50cmltKHN0ckdQWCwgbmV3IERhdGUoZHRzdCksIG5ldyBEYXRlKGR0ZWQpKTtcbiAgLy8g57WQ5p6c6KGo56S6XG4gICQoJyNyZXN1bHRzdCcpLmh0bWwoZ3B4dHJpbS5nZXRTdGF0dXMoKS5yZXBsYWNlKC9cXG4vZywgXCI8YnIvPlwiKSk7XG4gIC8vIOODgOOCpuODs+ODreODvOODiVxuICBkb3dubG9hZEdQWChyZXN1bHQpO1xufVxuXG4vKiogR1BY44KS44OA44Km44Oz44Ot44O844OJ44GZ44KLKi9cbmZ1bmN0aW9uIGRvd25sb2FkR1BYKHJlc3VsdCl7XG4gIHZhciBibG9iID0gbmV3IEJsb2IoW3Jlc3VsdF0se3R5cGU6J3RleHQveG1sJ30pO1xuICB2YXIgJGJ0biA9ICQoJyNidG5Eb3dubG9hZCcpO1xuICAkYnRuLmF0dHIoJ2hyZWYnLFVSTC5jcmVhdGVPYmplY3RVUkwoYmxvYikpO1xuICAkYnRuLmF0dHIoJ3RhcmdldCcsJ19ibGFuaycpO1xuICAkYnRuLmF0dHIoJ2Rvd25sb2FkJyxmaWxlR1BYLm5hbWUpO1xuICAkYnRuLnRleHQoXCLlpInmj5vjgZfjgZ9HUFjjg5XjgqHjgqTjg6vjgpLjg4Djgqbjg7Pjg63jg7zjg4lcIik7XG59XG5cblxuLyoqIOODleOCoeOCpOODq+ioreWumiovXG5mdW5jdGlvbiBjaGFuZ2VGaWxlKCkge1xuICAvLyDmqZ/og73jg4Hjgqfjg4Pjgq9cbiAgaWYgKCEod2luZG93LkZpbGUgJiYgd2luZG93LkZpbGVSZWFkZXIgJiYgd2luZG93LkZpbGVMaXN0ICYmIHdpbmRvdy5CbG9iKSkge1xuICAgIC8vIOWIneacn+WMllxuICAgIGNsZWFyRmlsZSgpO1xuICAgIGFsZXJ0KCdUaGUgRmlsZSBBUElzIGFyZSBub3QgZnVsbHkgc3VwcG9ydGVkIGluIHRoaXMgYnJvd3Nlci4nKTtcbiAgfVxuXG4gIC8vIOODleOCoeOCpOODq+WPluW+l1xuICBmaWxlR1BYID0gJCh0aGlzKS5wcm9wKCdmaWxlcycpWzBdO1xuICB2YXIgcmVhZGVyID0gbmV3IEZpbGVSZWFkZXIoKTtcbiAgcmVhZGVyLm9ubG9hZCA9IChmdW5jdGlvbihmZGF0YSkge1xuICAgIHJldHVybiBmdW5jdGlvbihlKSB7XG4gICAgICBzdHJHUFggPSBlLnRhcmdldC5yZXN1bHQ7XG4gICAgICBpZiAoIWdweHRyaW0udmFsaWRHUFgoc3RyR1BYKSkge1xuICAgICAgICBjbGVhckZpbGUoKTtcbiAgICAgICAgYWxlcnQoXCLmjIflrprjgZfjgZ/jg5XjgqHjgqTjg6vjgYxHUFjjg5XjgqHjgqTjg6vjgajjgZfjgaboqo3orZjjgafjgY3jgb7jgZvjgpPjgafjgZfjgZ/jgIJVVEYtOE7jga5HUFjjg5XjgqHjgqTjg6vjgpLmjIflrprjgZfjgabjgY/jgaDjgZXjgYTjgIJcIik7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGRldGVjdEdQWChzdHJHUFgpO1xuICAgIH07XG4gIH0pKGZpbGVHUFgpO1xuXG4gIC8vIOiqreOBv+i+vOOBv+mWi+Wni1xuICByZWFkZXIucmVhZEFzVGV4dChmaWxlR1BYKTtcbn1cblxuLyoqIOiqreOBv+i+vOOCk+OBoOODleOCoeOCpOODq+OCkuino+aUvuOBmeOCiyovXG5mdW5jdGlvbiBjbGVhckZpbGUoKSB7XG4gIHN0ckdQWCA9IFwiXCI7XG4gIGZpbGVHUFggPSBcIlwiO1xuICByYW5nZUdQWCA9IHt9O1xuICAkKCcjYnRuRG93bmxvYWQnKS50ZXh0KFwiXCIpO1xuICAkKCcjcmVzdWx0c3QnKS50ZXh0KFwiXCIpO1xuICAkKCcjZ3B4c3RhdHVzJykudGV4dChcIlwiKTtcbiAgJCgnI3RleHRTdGFydCcpLnZhbChcIlwiKTtcbiAgJCgnI3RleHRFbmQnKS52YWwoXCJcIik7XG4gIC8vIOODleOCoeOCpOODq+OCkuODquOCu+ODg+ODiFxuICAkKCcjZmlsZUdweCcpLnVuYmluZCgpO1xuICAkKCcjcGhGaWxlJykuaHRtbCgkKCcjcGhGaWxlJykuaHRtbCgpKTtcbiAgJCgnI2ZpbGVHcHgnKS5jaGFuZ2UoY2hhbmdlRmlsZSk7XG59XG5cbi8qKiBHUFjjg5XjgqHjgqTjg6vjga7plovlp4vjgajntYLkuobmmYLplpPjgpLoqq3jgb/lj5bjgaPjgabjgIHjg5rjg7zjgrjjgavlj43mmKDjgZXjgZvjgosqL1xuZnVuY3Rpb24gZGV0ZWN0R1BYKGRhdGEpIHtcbiAgcmFuZ2VHUFggPSBncHh0cmltLmdldFRpbWUoZGF0YSk7XG4gICQoJyNncHhzdGF0dXMnKS5odG1sKFwi6ZaL5aeL5pel5pmCOlwiK3N0ckRhdGUocmFuZ2VHUFguZmlyc3QpK1wiPGJyLz7ntYLkuobml6XmmYI6XCIrc3RyRGF0ZShyYW5nZUdQWC5sYXN0KSk7XG4gICQoJyN0ZXh0U3RhcnQnKS52YWwoc3RyRGF0ZShyYW5nZUdQWC5maXJzdCkpO1xuICAkKCcjdGV4dEVuZCcpLnZhbChzdHJEYXRlKHJhbmdlR1BYLmxhc3QpKTtcbn1cblxuZnVuY3Rpb24gc3RyRGF0ZShkdCkge1xuICByZXR1cm4gXCJcIitkdC5nZXRGdWxsWWVhcigpK1wiL1wiKyhkdC5nZXRNb250aCgpKzEpK1wiL1wiK2R0LmdldERhdGUoKStcIiBcIitkdC5nZXRIb3VycygpK1wiOlwiK2R0LmdldE1pbnV0ZXMoKStcIjpcIitkdC5nZXRTZWNvbmRzKCk7XG59XG5cbn0pLmNhbGwodGhpcyxyZXF1aXJlKFwiVkNtRXN3XCIpLHR5cGVvZiBzZWxmICE9PSBcInVuZGVmaW5lZFwiID8gc2VsZiA6IHR5cGVvZiB3aW5kb3cgIT09IFwidW5kZWZpbmVkXCIgPyB3aW5kb3cgOiB7fSxyZXF1aXJlKFwiYnVmZmVyXCIpLkJ1ZmZlcixhcmd1bWVudHNbM10sYXJndW1lbnRzWzRdLGFyZ3VtZW50c1s1XSxhcmd1bWVudHNbNl0sXCIvZmFrZV9jYTRhNmE2Mi5qc1wiLFwiL1wiKSIsIihmdW5jdGlvbiAocHJvY2VzcyxnbG9iYWwsQnVmZmVyLF9fYXJndW1lbnQwLF9fYXJndW1lbnQxLF9fYXJndW1lbnQyLF9fYXJndW1lbnQzLF9fZmlsZW5hbWUsX19kaXJuYW1lKXtcbi8qKlxuICogR1BY44Gu5pW055CG44KS6KGM44GG44Op44Kk44OW44Op44OqXG4gKi9cbnZhciBET01QYXJzZXIgPSByZXF1aXJlKCd4bWxkb20nKS5ET01QYXJzZXI7XG5cbi8qKlxuICog5YmN5Zue44Gu5Yem55CG57WQ5p6c44KS6KiY6YyyXG4gKi9cbnZhciBsYXN0U3RhdHVzID0gXCJcIjtcblxuZXhwb3J0cy5nZXRTdGF0dXMgPSBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIGxhc3RTdGF0dXM7XG59O1xuXG4vKiog5oyH5a6a44Gu5paH5a2X5YiX44GMR1BY44Go44GX44Gm6Kej6YeI44Gn44GN44KL44GL44KS56K66KqN44GZ44KLXG4gKiBAcGFyYW0gc3RyaW5nIGdweCDoqq3jgb/ovrzjgpPjgaBHUFjmloflrZfliJdcbiAqIEByZXR1cm4gdHJ1ZT3llY/poYzjgarjgZcgLyBmYWxzZT3jgqjjg6njg7zjgIJnZXRTdGF0dXMoKeOBp+e1kOaenOOCkuiqreOBv+WPluOCjOOCi1xuICovXG5leHBvcnRzLnZhbGlkR1BYID0gZnVuY3Rpb24oZ3B4KSB7XG4gIHZhciBkb2MgPSBuZXcgRE9NUGFyc2VyKCkucGFyc2VGcm9tU3RyaW5nKGdweCwgXCJhcHBsaWNhdGlvbi94bWxcIik7XG4gIHJldHVybiAoZG9jLmdldEVsZW1lbnRzQnlUYWdOYW1lKCdncHgnKS5sZW5ndGggPiAwKTtcbn1cblxuLyoqXG4gKiB0cmtzZWfjgr/jgrDjgpLliYrpmaRcbiAqIEBwYXJhbSBzdHJpbmcgZ3B4IEdQWOaWh+Wtl+WIl1xuICogQHJldHVybiBzdHJpbmcg44K/44Kw44KS5YmK6Zmk44GX44Gf5b6M44GuR1BY44KS5paH5a2X5YiX44Gn6L+U44GZ44CC5aSx5pWX5pmC44GvZmFsc2XjgpLov5TjgZlcbiAqL1xuZXhwb3J0cy5yZW1vdmVTZWdtZW50ID0gZnVuY3Rpb24gKGdweCkge1xuICB2YXIgcGFyc2VyID0gbmV3IERPTVBhcnNlcigpO1xuICB2YXIgc2VncztcbiAgdmFyIGNsb25lID0gXCJcIjtcbiAgdmFyIHNlZ2NoaWxkcyA9IFwiXCI7XG4gIHZhciBkb2MgPSBwYXJzZXIucGFyc2VGcm9tU3RyaW5nKGdweCwgXCJhcHBsaWNhdGlvbi94bWxcIik7XG4gIHNlZ3MgPSBkb2MuZ2V0RWxlbWVudHNCeVRhZ05hbWUoJ3Rya3NlZycpO1xuXG4gIC8vIOODgeOCp+ODg+OCr1xuICBpZiAoIWV4cG9ydHMudmFsaWRHUFgoZ3B4KSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIOS4jeimgeOBqnRya3NlZ+OCkuWJiumZpFxuICBmb3IgKHZhciBpPTEgOyBpPHNlZ3MubGVuZ3RoIDsgKSB7XG4gICAgZm9yICh2YXIgaj0wIDsgajxzZWdzWzFdLmNoaWxkTm9kZXMubGVuZ3RoIDsgaisrKSB7XG4gICAgICBzZWdzWzBdLmFwcGVuZENoaWxkKHNlZ3NbMV0uY2hpbGROb2Rlc1tqXS5jbG9uZU5vZGUodHJ1ZSkpO1xuICAgIH1cbiAgICAvLyDjgrPjg5Tjg7zjgZfjgZ/jgrvjgrDjg6Hjg7Pjg4jjgpLliYrpmaRcbiAgICBzZWdzWzFdLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoc2Vnc1sxXSk7XG4gIH1cblxuICAvLyDkuI3opoHjgarpoIXnm67jgpLliYrpmaRcbiAgcmV0dXJuIGRvYy50b1N0cmluZygpXG4gICAgLnJlcGxhY2UoL1xccnxcXG4vZ2ksIFwiXCIpXG4gICAgLnJlcGxhY2UoLyAqPC9nLFwiPFwiKVxuICAgIC5yZXBsYWNlKC8+ICovZyxcIj5cIilcbiAgICAucmVwbGFjZSgvICpcXD8+L2csXCI/PlwiKVxuICAgIC5yZXBsYWNlKC9cXHQvaSxcIiBcIik7XG59O1xuXG4vKipcbiAqIOaMh+WumuOBruevhOWbsuOBq0dQWOODh+ODvOOCv+OCkuS4uOOCgei+vOOCgOOAglxuICogQHBhcmFtIHN0cmluZyBncHggR1BY5paH5a2X5YiXXG4gKiBAcGFyYW0gRGF0ZSBzdGFydCDplovlp4vmmYLplpNcbiAqIEBwYXJhbSBEYXRlIGVuZCDntYLkuobmmYLplpNcbiAqIEByZXR1cm4gc3RyaW5nIFVURjjjgadHUFjmloflrZfliJfjgpLov5TjgZnjgILmlLnooYzjga/liYrpmaTjgILlpLHmlZfmmYLjga9mYWxzZeOCkui/lOOBmVxuICovXG5leHBvcnRzLnRyaW0gPSBmdW5jdGlvbiAoZ3B4LCBzdGFydCwgZW5kKSB7XG4gIHZhciB0bTtcbiAgdmFyIHBhcmVudDtcbiAgdmFyIHBhcnNlciA9IG5ldyBET01QYXJzZXIoKTtcbiAgdmFyIGRvYyA9IHBhcnNlci5wYXJzZUZyb21TdHJpbmcoZ3B4LCBcImFwcGxpY2F0aW9uL3htbFwiKTtcbiAgdmFyIHRpbWVzID0gZG9jLmdldEVsZW1lbnRzQnlUYWdOYW1lKCd0aW1lJyk7XG4gIHZhciBpc0ZpcnN0ID0gdHJ1ZTtcbiAgdmFyIGxhc3R0cmsgPSAwO1xuICB2YXIgY2xvbmU7XG4gIHZhciBub1N0YXJ0ID0gZmFsc2U7XG4gIHZhciBub0VuZCA9IGZhbHNlO1xuXG4gIC8vIOODgeOCp+ODg+OCr1xuICBpZiAoIWV4cG9ydHMudmFsaWRHUFgoZ3B4KSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIC8vIOWHpueQhuWGheWuueOCkuODquOCu+ODg+ODiFxuICBsYXN0U3RhdHVzID0gXCJcIjtcblxuICAvLyDjg4fjg7zjgr/jga7jg4Hjgqfjg4Pjgq9cbiAgaWYgKCEoc3RhcnQgaW5zdGFuY2VvZiBEYXRlKSkge1xuICAgIG5vU3RhcnQgPSB0cnVlO1xuICB9XG4gIGlmICghKGVuZCBpbnN0YW5jZW9mIERhdGUpKSB7XG4gICAgbm9FbmQgPSB0cnVlO1xuICB9XG5cbiAgLy8g44OH44O844K/44GM44Gq44GL44Gj44Gf44KJ5L2V44KC44Gb44Ga44Gr6L+U44GZXG4gIGlmICh0aW1lcy5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gZXhwb3J0cy5yZW1vdmVTZWdtZW50KGRvYy50b1N0cmluZygpKTtcbiAgfVxuXG4gIC8vIOODh+ODvOOCv+OCkuODiOODquODn+ODs+OCsFxuICBmb3IgKHZhciBpPTAgOyBpPHRpbWVzLmxlbmd0aCA7IGkrKykge1xuICAgIGlmICh0aW1lc1tpXS5wYXJlbnROb2RlLnRhZ05hbWUgIT09IFwidHJrcHRcIikgY29udGludWU7XG5cbiAgICAvLyDmnIDliJ3jga4x44Gk44KB44GMc3RhcnTjgojjgorlvozjgo3jgaDjgaPjgZ/jgonjgIHmnIDliJ3jgavjg4fjg7zjgr/jgpLov73liqDjgZnjgotcbiAgICBpZiAoICBpc0ZpcnN0ICYmXG4gICAgICAgICAgIW5vU3RhcnQgJiZcbiAgICAgICAgICAobmV3IERhdGUodGltZXNbaV0uZmlyc3RDaGlsZCkgPiBzdGFydCkpIHtcbiAgICAgIGNsb25lID0gZ2V0Q2xvbmVUcmtwdCh0aW1lc1tpXSwgZG9jLmNyZWF0ZVRleHROb2RlKElTT0RhdGVTdHJpbmcoc3RhcnQpKSk7XG4gICAgICB0aW1lc1tpXS5wYXJlbnROb2RlLnBhcmVudE5vZGUuaW5zZXJ0QmVmb3JlKGNsb25lLCB0aW1lc1tpXS5wYXJlbnROb2RlKTtcbiAgICAgIGlzRmlyc3QgPSBmYWxzZTtcbiAgICAgIGxhc3RTdGF0dXMgKz0gXCJBZGQgU3RhcnQgRGF0YTpcIitzdGFydCtcIlxcblwiO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlzRmlyc3QgPSBmYWxzZTtcblxuICAgIC8vIOacgOW+jOOBruODh+ODvOOCv1xuICAgIGxhc3R0cmsgPSBpO1xuXG4gICAgLy8g5pmC6ZaT44KI44KK5YmN44GLXG4gICAgdG0gPSBuZXcgRGF0ZSh0aW1lc1tpXS5maXJzdENoaWxkKTtcbiAgICBpZiAoICAoKHRtIDwgc3RhcnQpICYmICFub1N0YXJ0KSB8fFxuICAgICAgICAgICgodG0gPiBlbmQpICYmICFub0VuZCkpIHtcbiAgICAgIC8vIOOBk+OBruODh+ODvOOCv+OCkuWJiumZpFxuICAgICAgdGltZXNbaV0ucGFyZW50Tm9kZS5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKHRpbWVzW2ldLnBhcmVudE5vZGUpO1xuICAgICAgaS0tO1xuICAgICAgLy9cbiAgICAgIGxhc3RTdGF0dXMgKz0gXCJSZW1vdmUgRGF0YTpcIit0bStcIlxcblwiO1xuICAgIH1cbiAgfVxuXG4gIC8vIOacgOW+jOOBruaZgumWk+OBjGVuZOOCiOOCiuWJjeOBoOOBo+OBn+OCiei/veWKoFxuICBpZiAoKHRtIDwgZW5kKSAmJiAoIW5vRW5kKSkge1xuICAgIGNsb25lID0gZ2V0Q2xvbmVUcmtwdCh0aW1lc1tsYXN0dHJrXSwgZG9jLmNyZWF0ZVRleHROb2RlKElTT0RhdGVTdHJpbmcoZW5kKSkpO1xuICAgIHRpbWVzW2xhc3R0cmtdLnBhcmVudE5vZGUucGFyZW50Tm9kZS5hcHBlbmRDaGlsZChjbG9uZSwgdGltZXNbbGFzdHRya10ucGFyZW50Tm9kZSk7XG4gICAgbGFzdFN0YXR1cyArPSBcIkFkZCBFbmQgRGF0YTpcIitlbmQrXCJcXG5cIjtcbiAgfVxuXG4gIHJldHVybiBleHBvcnRzLnJlbW92ZVNlZ21lbnQoZG9jLnRvU3RyaW5nKCkpO1xufTtcblxuLyoqXG4gKiDmjIflrprjga50aW1l44Ko44Os44Oh44Oz44OI44KS5ZCr44KAdHJrcHTjgqjjg6zjg6Hjg7Pjg4jjgpLopIfoo73jgZfjgabjgIHmjIflrprjga7mmYLplpPjgavlt67jgZfmm7/jgYjjgotcbiAqIEBwYXJhbSBlbGVtZW50IGVsZW10bSDopIfoo73jgZnjgotET01FbGVtZW50XG4gKiBAcGFyYW0gZWxlbWVudCB0aW1lIOW3ruOBl+abv+OBiOOCi+aZgumWk+OCklRleHROb2Rl44Gr6Kit5a6a44GX44Gf44Ko44Os44Oh44Oz44OIXG4gKiBAcmV0dXJuIGVsZW1lbnQg44Kv44Ot44O844Oz44GX44Gm5pmC6ZaT44KS5beu44GX5pu/44GI44GfRE9NRWxlbWVudFxuICovXG5mdW5jdGlvbiBnZXRDbG9uZVRya3B0KGVsZW10bSwgdGltZSkge1xuICB2YXIgY2xvbmUgPSBlbGVtdG0ucGFyZW50Tm9kZS5jbG9uZU5vZGUodHJ1ZSk7XG4gIHZhciBjbG9uZXRpbWUgPSBjbG9uZS5nZXRFbGVtZW50c0J5VGFnTmFtZSgndGltZScpWzBdO1xuICBjbG9uZXRpbWUucmVtb3ZlQ2hpbGQoY2xvbmV0aW1lLmZpcnN0Q2hpbGQpO1xuICBjbG9uZXRpbWUuYXBwZW5kQ2hpbGQodGltZSk7XG4gIHJldHVybiBjbG9uZTtcbn1cblxuXG4vKipcbiAqIOaMh+WumuOBrui3nembouS7peWGheOBrueCueOCkuOBvuOBqOOCgeOCi+OAglxuICogQHBhcmFtIHN0cmluZyBncHggR1BY5paH5a2X5YiXXG4gKiBAcGFyYW0gbnVtYmVyIGRpc3Qg6Led6Zui44KS44Oh44O844OI44Or5Y2Y5L2N44Gn5oyH5a6a44CC44GT44Gu6Led6Zui5Lul5YaF44Gu54K544KS44G+44Go44KB44KLXG4gKiBAcGFyYW0gYm9vbCBsZWZ0TGFzdCB0cnVlPeacgOWIneOBqOacgOW+jOOBrueCueOCkuaui+OBmSAvIGZhbHNlPeacgOWIneOBrueCueOBruOBv+aui+OBmeOAguWIneacn+WApOOBr3RydWVcbiAqIEBwYXJhbSBib29sIHVzZUVsZSB0cnVlPemrmOW6puODh+ODvOOCv+OCkuWIqeeUqCAvIGZhbHNlPeaomemrmOOCkueEoeimliAvIOWIneacn+WApOOBr3RydWVcbiAqIEByZXR1cm4gc3RyaW5nIFVURjjjgadHUFjmloflrZfliJfjgpLov5TjgZnjgILmlLnooYzjga/liYrpmaTjgILlpLHmlZfmmYLjga9mYWxzZeOCkui/lOOBmVxuICovXG5leHBvcnRzLmdyb3VwID0gZnVuY3Rpb24oZ3B4LCBkaXN0LCBsZWZ0TGFzdCwgdXNlRWxlKSB7XG4gIC8vIOODgeOCp+ODg+OCr1xuICBpZiAoIWV4cG9ydHMudmFsaWRHUFgoZ3B4KSkge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIHJldHVybiBcIjxncHg+PC9ncHg+XCI7XG59O1xuXG4vKipcbiAqIOeVsOW4uOWApOOBruWJiumZpOOAguaMh+WumuOBruenkumAn+OCiOOCiuOCgumAn+OBhOenu+WLleOBpzHjgaTjgaDjgZHjga/jgb/lh7rjgZnngrnjgYzjgYLjgaPjgZ/jgonliYrpmaTjgZnjgotcbiAqIEBwYXJhbSBzdHJpbmcgZ3B4IEdQWOaWh+Wtl+WIl1xuICogQHBhcmFtIG51bWJlciB2ZWwg55Ww5bi45YCk44KS56eS6YCf44Gn5oyH5a6aXG4gKiBAcmV0dXJuIHN0cmluZyBVVEY444GnR1BY5paH5a2X5YiX44KS6L+U44GZ44CC5pS56KGM44Gv5YmK6Zmk44CC5aSx5pWX5pmC44GvZmFsc2XjgpLov5TjgZlcbiAqL1xuZXhwb3J0cy5jdXQgPSBmdW5jdGlvbihncHgsIHZlbCkge1xuICAvLyDjg4Hjgqfjg4Pjgq9cbiAgaWYgKCFleHBvcnRzLnZhbGlkR1BYKGdweCkpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cblxuICByZXR1cm4gXCI8Z3B4PjwvZ3B4PlwiO1xufTtcblxuLyoqXG4gKiDmmYLplpPjgpLlj5blvpfjgZfjgabjgIHjgqrjg5bjgrjjgqfjgq/jg4jjgafov5TjgZlcbiAqIEBwYXJhbSBzdHJpbmcgZ3B4IEdQWOOBrlVURjjmloflrZfliJdcbiAqIEByZXR1cm4gZmlyc3Q96ZaL5aeL5pmC6ZaTIC8gbGFzdD3ntYLkuobmmYLplpPjga5EYXRl44Kq44OW44K444Kn44Kv44OI44CC5aSx5pWX5pmC44GvZmFsc2XjgpLov5TjgZlcbiAqL1xuZXhwb3J0cy5nZXRUaW1lID0gZnVuY3Rpb24oZ3B4KSB7XG4gIHZhciBwYXJzZXIgPSBuZXcgRE9NUGFyc2VyKCk7XG4gIHZhciBkb2MgPSBwYXJzZXIucGFyc2VGcm9tU3RyaW5nKGdweCwgXCJhcHBsaWNhdGlvbi94bWxcIik7XG4gIHZhciB0aW1lcyA9IGRvYy5nZXRFbGVtZW50c0J5VGFnTmFtZSgndGltZScpO1xuICB2YXIgcmV0ID0ge307XG5cbiAgLy8g44OB44Kn44OD44KvXG4gIGlmICghZXhwb3J0cy52YWxpZEdQWChncHgpKSB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZm9yICh2YXIgaT0wIDsgaTx0aW1lcy5sZW5ndGggOyBpKyspIHtcbiAgICBpZiAodGltZXNbaV0ucGFyZW50Tm9kZS50YWdOYW1lICE9PSBcInRya3B0XCIpIHtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyDmnIDliJ3jga7jg4fjg7zjgr9cbiAgICBpZiAoIXJldC5oYXNPd25Qcm9wZXJ0eSgnZmlyc3QnKSkge1xuICAgICAgcmV0LmZpcnN0ID0gbmV3IERhdGUodGltZXNbaV0uZmlyc3RDaGlsZCk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgcmV0Lmxhc3QgPSBuZXcgRGF0ZSh0aW1lc1tpXS5maXJzdENoaWxkKTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJldDtcbn07XG5cbi8qIOacm+OBvuOCjOOCi+ato+eiuuOBquW9ouW8j+OBruOBn+OCgeOBq+mWouaVsOOCkuS9v+eUqOOBl+OBvuOBmS4uLlxuaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvamEvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvRGF0ZVxuKi9cbmZ1bmN0aW9uIElTT0RhdGVTdHJpbmcoZCl7XG4gIGZ1bmN0aW9uIHBhZChuKXtyZXR1cm4gbjwxMCA/ICcwJytuIDogbjt9XG4gIHJldHVybiBkLmdldFVUQ0Z1bGxZZWFyKCkrJy0nICtcbiAgICBwYWQoZC5nZXRVVENNb250aCgpKzEpKyctJyArXG4gICAgcGFkKGQuZ2V0VVRDRGF0ZSgpKSsnVCcgK1xuICAgIHBhZChkLmdldFVUQ0hvdXJzKCkpKyc6JyArXG4gICAgcGFkKGQuZ2V0VVRDTWludXRlcygpKSsnOicgK1xuICAgIHBhZChkLmdldFVUQ1NlY29uZHMoKSkrJ1onO1xufVxuXG59KS5jYWxsKHRoaXMscmVxdWlyZShcIlZDbUVzd1wiKSx0eXBlb2Ygc2VsZiAhPT0gXCJ1bmRlZmluZWRcIiA/IHNlbGYgOiB0eXBlb2Ygd2luZG93ICE9PSBcInVuZGVmaW5lZFwiID8gd2luZG93IDoge30scmVxdWlyZShcImJ1ZmZlclwiKS5CdWZmZXIsYXJndW1lbnRzWzNdLGFyZ3VtZW50c1s0XSxhcmd1bWVudHNbNV0sYXJndW1lbnRzWzZdLFwiL2dweC10cmltbWVyLmpzXCIsXCIvXCIpIl19
