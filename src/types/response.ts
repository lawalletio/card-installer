import {Skin} from './skin';

export type LoginResponse = {
  skins: Skin[];
  lnurlwBase: string;
};

export type InitializeCardResponse = {
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  privateUID?: string;
};

export type CardDesign = {
  id: string;
  imageUrl: string;
  description: string;
  createdAt: string;
  archivedAt?: string | null;
};

// Public NTAG424 fields returned by the read endpoints (GET /api/cards[/:id]).
// Keys are NOT included — they are only exported by the /write and /wipe
// endpoints (both of which unpair the card server-side).
export type Ntag424Public = {
  cid: string;
  ctr: number;
  createdAt: string;
};

export type Card = {
  id: string; // server-generated hex id (NOT the chip uid)
  design: {id: string; imageUrl: string; description: string; createdAt: string};
  ntag424: Ntag424Public;
  createdAt: string;
  title?: string;
  lastUsedAt?: string;
  pubkey?: string;
  username?: string;
  otc?: string;
  kind: string;
};

export type InstanceSettings = {
  community_name: string;
  domain: string;
  endpoint: string;
  subdomain: string;
  brand_theme: string;       // hex color e.g. "#22c55e"
  brand_rounding: 'Small' | 'Medium' | 'Large';
  logotype_url: string;      // full logo with text
  isotypo_url: string;       // icon / isotype
  maintenance_enabled: string;
  social_twitter?: string;
  social_discord?: string;
  social_nostr?: string;
  social_email?: string;
  social_website?: string;
};

export type Ntag424WriteData = {
  card_name: string;
  id: string;
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  lnurlw_base: string; // lnurlw://<host>/api/cards/<id>/scan
  protocol_name: 'new_bolt_card_response';
  protocol_version: '1';
};

// Reset payload from GET /api/cards/:id/wipe. Keys are top-level (not nested
// under `ntag424`). Fetching this endpoint unpairs the card server-side.
export type Ntag424WipeData = {
  action: 'wipe';
  k0: string;
  k1: string;
  k2: string;
  k3: string;
  k4: string;
  uid: string;
  version: 1;
};
