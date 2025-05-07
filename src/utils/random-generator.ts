import crypto from "crypto";

export default abstract class RandomGenerator {
  static getRandomCode(size: number) {
    return [...Array(size)]
      .map(() => Math.floor(Math.random() * 10).toString(10))
      .join('');
  }

  static getUniqueCode() {
    return (crypto.randomInt(100000, 999999)).toString();
  }
}
