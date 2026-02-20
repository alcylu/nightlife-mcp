import type { ModalTimeBucket } from "../types.js";

export interface ModalAnchor {
  id: string;
  name: string;
  description: string;
  target: {
    energy: number;
    social: number;
    discovery: number;
    budget: number;
    timeBucket: ModalTimeBucket;
  };
}

export const MODAL_ANCHORS: ModalAnchor[] = [
  {
    id: "underground_techno_club",
    name: "Underground Techno Club",
    description: "Deep, high-energy dance floors with cutting-edge selectors.",
    target: { energy: 5, social: 3, discovery: 5, budget: 3, timeBucket: "late" },
  },
  {
    id: "mainstream_edm_festival",
    name: "Mainstream EDM Festival",
    description: "Big-room festival energy with crowd-pleasing headliners.",
    target: { energy: 5, social: 5, discovery: 2, budget: 4, timeBucket: "prime" },
  },
  {
    id: "japanese_rock_livehouse",
    name: "Japanese Rock Livehouse",
    description: "Livehouse gigs focused on guitar-driven Japanese acts.",
    target: { energy: 4, social: 3, discovery: 3, budget: 3, timeBucket: "prime" },
  },
  {
    id: "jazz_lounge_live_set",
    name: "Jazz Lounge Live Set",
    description: "Intimate jazz-focused performances with relaxed pacing.",
    target: { energy: 2, social: 2, discovery: 4, budget: 4, timeBucket: "early" },
  },
  {
    id: "hiphop_rnb_party",
    name: "Hip-Hop / R&B Party",
    description: "Late-night vocal and beat-driven club sets.",
    target: { energy: 4, social: 4, discovery: 2, budget: 3, timeBucket: "late" },
  },
  {
    id: "latin_salsa_bachata_social",
    name: "Latin Salsa/Bachata Social",
    description: "Partner-dance-forward events with highly social interaction.",
    target: { energy: 4, social: 5, discovery: 3, budget: 2, timeBucket: "prime" },
  },
  {
    id: "punk_hardcore_diy_gig",
    name: "Punk/Hardcore DIY Gig",
    description: "Raw high-intensity sets with strong underground discovery value.",
    target: { energy: 5, social: 3, discovery: 5, budget: 2, timeBucket: "prime" },
  },
  {
    id: "experimental_ambient_av_show",
    name: "Experimental Ambient AV Show",
    description: "Atmospheric experimental programming and audiovisual immersion.",
    target: { energy: 2, social: 1, discovery: 5, budget: 3, timeBucket: "early" },
  },
  {
    id: "drag_cabaret_show",
    name: "Drag Cabaret Show",
    description: "Performance-led nightlife with expressive hosts and audience engagement.",
    target: { energy: 3, social: 4, discovery: 4, budget: 3, timeBucket: "prime" },
  },
  {
    id: "rooftop_house_disco_party",
    name: "Rooftop House/Disco Party",
    description: "Stylish social dance settings with house/disco-oriented programming.",
    target: { energy: 4, social: 4, discovery: 3, budget: 4, timeBucket: "prime" },
  },
];
