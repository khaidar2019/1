export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
