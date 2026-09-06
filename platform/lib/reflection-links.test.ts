import { describe, it, expect } from "vitest";
import { studentViewHref } from "./reflection-links";

describe("studentViewHref", () => {
  const TEST = "f5221cd9-66b1-48cd-bfe3-652d87df26b2";
  const PROFILE = "0af5cea8-1850-47a7-8ab5-6b37f8f18420";
  const INVITED = "59847628-2bdf-4e83-9568-77af0b292c48";

  it("sends a signed-in student to ?viewStudent=, unchanged", () => {
    expect(studentViewHref(TEST, PROFILE)).toBe(
      `/dashboard/reflection?testId=${TEST}&viewStudent=${PROFILE}`
    );
  });

  // The regression this pins: ?viewStudent= resolves its value against uuid
  // columns, so an "invited-" id opened a blank page for every student who
  // has not signed in -- on a freshly scanned class, all of them.
  it("sends a roster-only student to ?viewAs=, with the prefix stripped", () => {
    expect(studentViewHref(TEST, `invited-${INVITED}`)).toBe(
      `/dashboard/reflection?testId=${TEST}&viewAs=${INVITED}`
    );
  });

  it("never leaks the invited- prefix into a query value", () => {
    expect(studentViewHref(TEST, `invited-${INVITED}`)).not.toContain("invited-");
  });

  it("never routes a roster id through viewStudent", () => {
    expect(studentViewHref(TEST, `invited-${INVITED}`)).not.toContain("viewStudent");
  });

  it("never routes a profile id through viewAs", () => {
    expect(studentViewHref(TEST, PROFILE)).not.toContain("viewAs");
  });
});
