import { describe, expect, it } from "vitest";
import { PROFILE_CSV_HEADERS, ProfileCsvError, parseProfilesCsv } from "../src/shared/profile-csv.js";

const row = [
  "Drop profile",
  "Jane",
  "Doe",
  "jane@example.com",
  "555-0100",
  "4242 4242 4242 4242",
  "8",
  "29",
  "123",
  "1 Main St",
  "Apt 2",
  "New York",
  "NY",
  "10001",
  "United States",
  "Jane",
  "Doe",
  "2 Billing Rd",
  "",
  "Brooklyn",
  "NY",
  "11201",
  "USA",
];

const csv = (values = row) => `${PROFILE_CSV_HEADERS.join(",")}\r\n${values.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")}\r\n`;

describe("profile CSV import", () => {
  it("accepts the supplied 23-column profile format", () => {
    let id = 0;
    const profiles = parseProfilesCsv(csv(), "group-1", () => `profile-${++id}`);
    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: "profile-1",
      groupId: "group-1",
      name: "Drop profile",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      address1: "1 Main St",
      address2: "Apt 2",
      city: "New York",
      region: "NY",
      postalCode: "10001",
      country: "US",
      payment: { brand: "Visa", last4: "4242", expiryMonth: "08", expiryYear: "2029", billingSameAsShipping: false },
      billing: { address1: "2 Billing Rd", city: "Brooklyn", country: "US" },
    });
    expect(JSON.stringify(profiles[0])).not.toContain("4242424242424242");
    expect(JSON.stringify(profiles[0])).not.toContain('"123"');
  });

  it("uses shipping as billing when billing columns are blank", () => {
    const values = [...row];
    for (let index = 15; index < values.length; index += 1) values[index] = "";
    const [profile] = parseProfilesCsv(csv(values), "group-1", () => "profile-1");
    expect(profile?.payment?.billingSameAsShipping).toBe(true);
    expect(profile?.billing).toMatchObject({ address1: "1 Main St", city: "New York", country: "US" });
  });

  it("reports missing columns and invalid rows without returning partial imports", () => {
    expect(() => parseProfilesCsv("profile_name,email\nTest,test@example.com", "group-1")).toThrow(ProfileCsvError);
    const invalid = [...row];
    invalid[3] = "not-an-email";
    expect(() => parseProfilesCsv(csv(invalid), "group-1")).toThrow(/Row 2: email is invalid/);
  });
});
