import { describe, expect, it } from "vitest";
import { rupeesInWords, wholeNumberInWords } from "@shared/utils/inWords";

describe("net pay in words, Indian convention", () => {
  it.each([
    ["0", "Rupees Zero Only"],
    ["0.00", "Rupees Zero Only"],
    ["1", "Rupees One Only"],
    ["19", "Rupees Nineteen Only"],
    ["20", "Rupees Twenty Only"],
    ["101", "Rupees One Hundred One Only"],
    ["1000", "Rupees One Thousand Only"],
    ["99999.50", "Rupees Ninety Nine Thousand Nine Hundred Ninety Nine and Fifty Paise Only"],
    ["100000", "Rupees One Lakh Only"],
    ["100000.00", "Rupees One Lakh Only"],
    ["123456", "Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only"],
    ["1000000", "Rupees Ten Lakh Only"],
    ["10000000", "Rupees One Crore Only"],
    ["12345678.9", "Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight and Ninety Paise Only"],
    ["1000000000", "Rupees One Hundred Crore Only"],
    ["0.05", "Rupees Five Paise Only"],
    ["45000.01", "Rupees Forty Five Thousand and One Paise Only"],
    ["1200000.5", "Rupees Twelve Lakh and Fifty Paise Only"],
  ])("%s", (amount, words) => {
    expect(rupeesInWords(amount)).toBe(words);
  });

  it("refuses anything that is not an amount of whole paise", () => {
    for (const bad of ["", "-5", "1.234", "1,000", "abc", "1e5"]) expect(() => rupeesInWords(bad), bad).toThrow();
  });

  it("reads the group edges", () => {
    expect(wholeNumberInWords("99999999")).toBe("Nine Crore Ninety Nine Lakh Ninety Nine Thousand Nine Hundred Ninety Nine");
    expect(wholeNumberInWords("100")).toBe("One Hundred");
    expect(wholeNumberInWords("1001")).toBe("One Thousand One");
  });
});
