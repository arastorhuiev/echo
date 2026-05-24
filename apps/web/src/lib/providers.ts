export type ProviderField = {
  name: string
  label: string
  kind?: "string" | "array"
  type?: "text" | "password"
  default?: string
  hint?: string
}

export type ProviderCategory = "username" | "email" | "phone" | "image" | "breach"

export type Provider = {
  id: string
  category: ProviderCategory
  description: string
  envConditional?: boolean
  fields: ProviderField[]
}

const username: ProviderField = {
  name: "username",
  label: "Username",
  default: "efinswim",
}
const email: ProviderField = {
  name: "email",
  label: "Email",
  default: "efinswim@gmail.com",
}
const phone: ProviderField = {
  name: "phone",
  label: "Phone (E.164)",
  default: "+48537529192",
}

export const providers: Provider[] = [
  {
    id: "sherlock",
    category: "username",
    description: "Username hunt across hundreds of social platforms.",
    fields: [username],
  },
  {
    id: "maigret",
    category: "username",
    description: "Sherlock's bigger sibling — ~3000 sites.",
    fields: [username],
  },
  {
    id: "whatsmyname",
    category: "username",
    description: "Node-native fan-out over the WhatsMyName dataset (~700 sites).",
    fields: [username],
  },
  {
    id: "socialscan",
    category: "username",
    description: "Username/email availability check across ~10 platforms.",
    fields: [
      {
        name: "queries",
        label: "Queries",
        kind: "array",
        default: "efinswim, efinswim@gmail.com",
        hint: "Comma-separated. Accepts mix of usernames and emails (1-10).",
      },
    ],
  },
  {
    id: "socid-extractor",
    category: "username",
    description: "Profile URL → site-specific IDs (~130 parsers).",
    fields: [{ name: "url", label: "Profile URL", default: "https://t.me/durov" }],
  },
  {
    id: "mailcat",
    category: "username",
    description: "Username → likely email addresses (~22 providers).",
    envConditional: true,
    fields: [username],
  },
  {
    id: "phonenumbers",
    category: "phone",
    description: "Pure-offline libphonenumber validation + metadata.",
    fields: [phone],
  },
  {
    id: "phoneinfoga",
    category: "phone",
    description: "Country + Google dork URLs (PhoneInfoga REST).",
    fields: [phone],
  },
  {
    id: "telegram-resolve",
    category: "phone",
    description: "Phone → Telegram profile via MTProto.",
    envConditional: true,
    fields: [phone],
  },
  {
    id: "truecaller",
    category: "phone",
    description: "Phone → crowd-sourced name + spam score.",
    envConditional: true,
    fields: [phone, { name: "country_code", label: "Country (ISO-2)", default: "PL" }],
  },
  {
    id: "ignorant",
    category: "phone",
    description: "Phone → social presence on Instagram / Snapchat / Amazon.",
    fields: [
      {
        name: "country_code",
        label: "Dialling code (digits, no '+')",
        default: "48",
      },
      {
        name: "phone",
        label: "National phone (digits)",
        default: "537529192",
      },
    ],
  },
  {
    id: "hibp-pwned-passwords",
    category: "breach",
    description:
      "k-anonymity password breach check — password is hashed locally, only the first 5 hex chars cross the network.",
    fields: [
      {
        name: "password",
        label: "Password",
        type: "password",
        default: "password123",
      },
    ],
  },
  {
    id: "ghunt",
    category: "email",
    description: "Email → Google profile, Maps reviews, gaia_id.",
    envConditional: true,
    fields: [email],
  },
  {
    id: "exiftool",
    category: "image",
    description: "Image URL → EXIF / IPTC / XMP metadata.",
    fields: [
      {
        name: "image_url",
        label: "Image URL",
        default:
          "https://raw.githubusercontent.com/ianare/exif-samples/master/jpg/gps/DSCN0010.jpg",
      },
    ],
  },
]

export const API_BASE: string =
  (typeof import.meta !== "undefined" &&
    (import.meta as ImportMeta & { env?: { PUBLIC_API_BASE?: string } }).env?.PUBLIC_API_BASE) ||
  "http://localhost:3000/api"
