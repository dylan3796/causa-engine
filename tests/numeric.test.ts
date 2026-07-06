import { describe, expect, it } from "vitest";
import { R1_count, R2_unitCents, R3_dollars, R4_pct, R4_share2, clamp, roundHalfUp } from "@/src/numeric";

describe("rounding registry", () => {
  it("rounds half up", () => {
    expect(roundHalfUp(211.75)).toBe(212);
    expect(roundHalfUp(42.5)).toBe(43);
    expect(roundHalfUp(42.4999999)).toBe(42);
    expect(roundHalfUp(813.0)).toBe(813);
  });

  it("rejects negative quantities", () => {
    expect(() => roundHalfUp(-1)).toThrow(/non-negative/);
  });

  it("R2 unit costs are exact on the Meridian marginals", () => {
    expect(R2_unitCents(206703, 1737)).toBe(119);
    expect(R2_unitCents(139515, 1065)).toBe(131);
    expect(R2_unitCents(482100, 2802)).toBe(172);
    expect(R2_unitCents(20400, 486)).toBe(42);
    expect(R2_unitCents(198400, 601)).toBe(330);
    expect(R2_unitCents(290000, 314)).toBe(924);
  });

  it("R4 percents match the published ledger", () => {
    expect(R4_pct(2802, 3214)).toBe(87);
    expect(R4_pct(601, 640)).toBe(94);
    expect(R4_pct(314, 472)).toBe(67);
    expect(R4_pct(1989, 2802)).toBe(71);
    expect(R4_pct(640, 1049)).toBe(61);
    expect(R4_pct(252, 2802)).toBe(9);
    expect(R4_share2(1737, 2802)).toBe(0.62);
    expect(R4_share2(511, 601)).toBe(0.85);
    expect(R4_share2(496, 800)).toBe(0.62);
  });

  it("R5: the fair price must round BEFORE the delta is taken (the $1,233 vs ~$1,220 trap)", () => {
    const rate = 150;
    const attributable = 1989;
    const verified = 2802;
    const fairRounded = roundHalfUp((rate * attributable) / verified); // 106¢
    expect(fairRounded).toBe(106);
    const publishedImpact = R3_dollars(((rate - fairRounded) * verified) / 100);
    expect(publishedImpact).toBe(1233);
    // Using the unrounded fair price breaks the published ledger:
    const fairUnrounded = (rate * attributable) / verified;
    const wrongImpact = R3_dollars(((rate - fairUnrounded) * verified) / 100);
    expect(wrongImpact).not.toBe(1233);
  });

  it("R1 counterfactual counts round once", () => {
    expect(R1_count((90 * 3523) / 390)).toBe(813);
    expect(R1_count((8 / 155) * 601)).toBe(31);
    expect(R1_count(0.11 * 1925)).toBe(212);
    expect(R1_count(0.175 * 240)).toBe(42);
  });

  it("clamp", () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});
