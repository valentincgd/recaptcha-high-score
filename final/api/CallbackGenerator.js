export class CallbackGenerator {
  static generate() {
    const n1 = Math.floor(Math.random() * 2147483648);
    const str1 = n1.toString(36);
    const timestamp = Math.floor(Date.now() / 1000);
    const n2 = Math.floor(Math.random() * 2147483648);
    const str2 = Math.abs(n2 ^ timestamp).toString(36);
    return str1 + str2;
  }
}
