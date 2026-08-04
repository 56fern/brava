import type { Profile } from "./types.js";

export const PROFILE_CSV_HEADERS = [
  "profile_name",
  "first_name",
  "last_name",
  "email",
  "phone_num",
  "cc_number",
  "cc_exp_month",
  "cc_exp_year",
  "cc_cvv",
  "shipping_street",
  "shipping_street_2",
  "shipping_city",
  "shipping_state",
  "shipping_zip_code",
  "shipping_country",
  "billing_first_name",
  "billing_last_name",
  "billing_street",
  "billing_street_2",
  "billing_city",
  "billing_state",
  "billing_zip_code",
  "billing_country",
] as const;

export class ProfileCsvError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(issues[0] ?? "Could not import this profile CSV.");
    this.name = "ProfileCsvError";
    this.issues = issues;
  }
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
      continue;
    }

    if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }

  if (quoted) throw new ProfileCsvError(["The CSV contains an unclosed quoted field."]);
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((values) => values.some((value) => value.trim().length));
}

const normalizeHeader = (value: string) => value.replace(/^\uFEFF/, "").trim().toLowerCase();
const digits = (value: string) => value.replace(/\D/g, "");
const normalized = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");

function normalizeCountry(value: string): string {
  const country = normalized(value).replace(/\./g, "");
  if (["us", "usa", "united states", "united states of america"].includes(country)) return "US";
  if (["ca", "can", "canada"].includes(country)) return "CA";
  if (["gb", "gbr", "uk", "united kingdom", "great britain"].includes(country)) return "GB";
  return value.trim().toUpperCase();
}

function cardBrand(number: string): NonNullable<Profile["payment"]>["brand"] {
  if (/^4/.test(number)) return "Visa";
  if (/^(34|37)/.test(number)) return "Amex";
  const prefix = Number(number.slice(0, 4));
  if (/^5[1-5]/.test(number) || (prefix >= 2221 && prefix <= 2720)) return "Mastercard";
  if (/^(6011|65|64[4-9])/.test(number)) return "Discover";
  return "Other";
}

function required(record: Record<string, string>, key: string, rowNumber: number, label = key): string {
  const value = record[key]?.trim() ?? "";
  if (!value) throw new Error(`Row ${rowNumber}: ${label} is required.`);
  return value;
}

function sameAddress(left: NonNullable<Profile["billing"]>, right: NonNullable<Profile["billing"]>): boolean {
  return (Object.keys(left) as Array<keyof typeof left>).every((key) => normalized(left[key]) === normalized(right[key]));
}

export function parseProfilesCsv(text: string, groupId: string, createId: () => string = () => crypto.randomUUID()): Profile[] {
  if (!groupId.trim()) throw new ProfileCsvError(["Select a profile group before importing."]);
  if (text.length > 5_000_000) throw new ProfileCsvError(["The CSV is larger than Brava's 5 MB import limit."]);

  const rows = parseCsvRows(text);
  if (!rows.length) throw new ProfileCsvError(["The CSV is empty."]);
  const headers = rows[0]!.map(normalizeHeader);
  const missing = PROFILE_CSV_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length) throw new ProfileCsvError([`Missing required column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`]);
  if (rows.length > 25_001) throw new ProfileCsvError(["A single CSV can contain at most 25,000 profiles."]);

  const issues: string[] = [];
  const profiles: Profile[] = [];
  rows.slice(1).forEach((values, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
    try {
      const firstName = required(record, "first_name", rowNumber, "first name");
      const lastName = required(record, "last_name", rowNumber, "last name");
      const email = required(record, "email", rowNumber);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error(`Row ${rowNumber}: email is invalid.`);
      const cardNumber = digits(required(record, "cc_number", rowNumber, "card number"));
      if (cardNumber.length < 12 || cardNumber.length > 19) throw new Error(`Row ${rowNumber}: card number must contain 12 to 19 digits.`);
      const expiryMonth = digits(required(record, "cc_exp_month", rowNumber, "expiry month")).padStart(2, "0");
      if (!/^(0[1-9]|1[0-2])$/.test(expiryMonth)) throw new Error(`Row ${rowNumber}: expiry month must be between 1 and 12.`);
      let expiryYear = digits(required(record, "cc_exp_year", rowNumber, "expiry year"));
      if (expiryYear.length === 2) expiryYear = `20${expiryYear}`;
      if (!/^\d{4}$/.test(expiryYear)) throw new Error(`Row ${rowNumber}: expiry year must use YY or YYYY.`);
      const securityCode = digits(required(record, "cc_cvv", rowNumber, "security code"));
      if (!/^\d{3,4}$/.test(securityCode)) throw new Error(`Row ${rowNumber}: security code must contain 3 or 4 digits.`);

      const shipping = {
        firstName,
        lastName,
        address1: required(record, "shipping_street", rowNumber, "shipping street"),
        address2: (record.shipping_street_2 ?? "").trim(),
        city: required(record, "shipping_city", rowNumber, "shipping city"),
        region: required(record, "shipping_state", rowNumber, "shipping state"),
        postalCode: required(record, "shipping_zip_code", rowNumber, "shipping ZIP code"),
        country: normalizeCountry(required(record, "shipping_country", rowNumber, "shipping country")),
      };
      const hasBilling = ["billing_first_name", "billing_last_name", "billing_street", "billing_city", "billing_state", "billing_zip_code", "billing_country"].some((key) => (record[key] ?? "").trim());
      const billing = hasBilling ? {
        firstName: (record.billing_first_name ?? "").trim() || firstName,
        lastName: (record.billing_last_name ?? "").trim() || lastName,
        address1: required(record, "billing_street", rowNumber, "billing street"),
        address2: (record.billing_street_2 ?? "").trim(),
        city: required(record, "billing_city", rowNumber, "billing city"),
        region: required(record, "billing_state", rowNumber, "billing state"),
        postalCode: required(record, "billing_zip_code", rowNumber, "billing ZIP code"),
        country: normalizeCountry(required(record, "billing_country", rowNumber, "billing country")),
      } : shipping;
      const billingSameAsShipping = sameAddress(billing, shipping);

      profiles.push({
        id: createId(),
        groupId,
        name: (record.profile_name ?? "").trim() || `${firstName} ${lastName}`,
        email,
        phone: required(record, "phone_num", rowNumber, "phone number"),
        ...shipping,
        payment: {
          cardholderName: `${firstName} ${lastName}`,
          brand: cardBrand(cardNumber),
          last4: cardNumber.slice(-4),
          expiryMonth,
          expiryYear,
          billingSameAsShipping,
        },
        billing,
      });
    } catch (cause) {
      issues.push(cause instanceof Error ? cause.message : `Row ${rowNumber}: invalid profile data.`);
    }
  });

  if (!profiles.length && !issues.length) issues.push("The CSV does not contain any profile rows.");
  if (issues.length) throw new ProfileCsvError(issues);
  return profiles;
}
