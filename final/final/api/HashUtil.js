export class HashUtil {
  static toSigned32bit(n) {
    n = n >>> 0;
    if (n >= 0x80000000) n -= 0x100000000;
    return n;
  }

  static hashString(data, numAt = 0) {
    for (let i = 0; i < data.length; i++) {
      numAt = HashUtil.toSigned32bit(
        ((numAt << 5) - numAt + data.charCodeAt(i)) >>> 0,
      );
    }
    return numAt;
  }
}
