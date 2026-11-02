// Seed script for 3 realistic demo accounts
// Run with: node scripts/seed-demo-accounts.mjs

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, query, limit } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCo44Lysb-ejCooFeZ3gMPSa7ylj7xkiGQ",
  authDomain: "captur-app-dev.firebaseapp.com",
  projectId: "captur-app-dev",
  storageBucket: "captur-app-dev.firebasestorage.app",
  appId: "1:377601203653:web:21b7ce3bc2d8136290ffac",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app, "us-central1");

async function getOrCreateUser(email, password) {
  try {
    const cred = await signInWithEmailAndPassword(auth, email, password);
    console.log(`Signed in existing user: ${email} (${cred.user.uid})`);
    return cred.user;
  } catch (err) {
    if (err.code === "auth/user-not-found" || err.code === "auth/invalid-credential") {
      try {
        const cred = await createUserWithEmailAndPassword(auth, email, password);
        console.log(`Created new user: ${email} (${cred.user.uid})`);
        return cred.user;
      } catch (createErr) {
        // Try signin one more time in case of race
        const cred = await signInWithEmailAndPassword(auth, email, password);
        return cred.user;
      }
    }
    throw err;
  }
}

async function triggerDecisionEngine(user, workspaceId, requestId) {
  try {
    const token = await user.getIdToken(true);
    const res = await fetch("https://us-central1-captur-app-dev.cloudfunctions.net/generateRecommendation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { workspaceId, requestId } }),
    });
    const json = await res.json();
    if (json.error) {
      console.log(`Decision Engine trigger notice: ${json.error.message}`);
    } else {
      console.log(`Decision Engine V3 recommendation generated successfully!`);
    }
  } catch (err) {
    console.log(`Decision Engine trigger: ${err.message}`);
  }
}

async function ensureWorkspace(user, wsPayload) {
  const token = await user.getIdToken();
  let wsId = `${user.uid}_${wsPayload.requestId}`;
  let bizId = null;

  try {
    const res = await fetch("https://us-central1-captur-app-dev.cloudfunctions.net/createWorkspace", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify({ data: wsPayload }),
    });
    const json = await res.json();
    if (json.result) {
      wsId = json.result.workspaceId || wsId;
      bizId = json.result.businessId;
    }
  } catch (err) {
    console.log(`createWorkspace notice for ${user.email}:`, err.message);
  }

  if (!bizId) {
    const bizSnap = await getDocs(query(collection(db, `workspaces/${wsId}/businesses`), limit(1)));
    bizId = bizSnap.docs[0]?.id;
  }

  console.log(`Workspace ready for ${user.email}: ${wsId} (business: ${bizId})`);
  return { workspaceId: wsId, businessId: bizId };
}

// Generate dates going back 30 days
function getDateAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

// ==========================================
// ACCOUNT 1: Social Seller (Maya - GlowAura)
// ==========================================
async function seedMaya() {
  console.log("\n--- Seeding Account 1: Social Seller ---");
  const email = "maya.seller@7captur-demo.com";
  const pass = "MayaSocialPass2026!";
  const user = await getOrCreateUser(email, pass);

  const { workspaceId, businessId } = await ensureWorkspace(user, {
    workspaceName: "GlowAura Social Boutique",
    businessName: "GlowAura Social Boutique",
    businessType: "creator_individual",
    objective: "content_testing",
    buyingMethods: ["website", "dm_whatsapp"],
    currency: "USD",
    timezone: "America/New_York",
    country: "US",
    requestId: "seed_maya_init_2026",
  });

  // Check if already seeded
  const existingPosts = await getDocs(query(collection(db, `workspaces/${workspaceId}/posts`), limit(1)));
  if (existingPosts.size > 0) {
    console.log("Maya's workspace already has records, skipping duplication.");
    return { email, pass, workspaceId };
  }

  console.log("Populating extensive social seller records...");

  // 1. Posts (TikTok and Instagram reels & carousels)
  const postsData = [
    { platform: "instagram", publishedAt: getDateAgo(28), format: "reel", topic: "Morning Hydration Routine", reach: 14200, views: 18500, likes: 1140, comments: 84, shares: 195, saves: 340, notes: "Top organic hook: 3 drops before moisturizer." },
    { platform: "tiktok", publishedAt: getDateAgo(26), format: "video", topic: "Dark Circles Fix in 10 Days", reach: 41200, views: 56000, likes: 3820, comments: 240, shares: 610, saves: 1420, notes: "Went semi-viral, drove 38 profile clicks." },
    { platform: "instagram", publishedAt: getDateAgo(24), format: "carousel", topic: "Ingredient Deep Dive: Niacinamide vs Vitamin C", reach: 9800, views: 12000, likes: 780, comments: 45, shares: 120, saves: 520, notes: "Educational carousel, high save rate." },
    { platform: "instagram", publishedAt: getDateAgo(21), format: "story", topic: "Packaging Weekend Orders Behind-the-Scenes", reach: 6400, views: 7100, likes: 420, comments: 38, shares: 15, saves: 22, notes: "Link sticker in bio drove immediate checkouts." },
    { platform: "tiktok", publishedAt: getDateAgo(18), format: "video", topic: "Testing Viral Glass Skin Trend", reach: 28400, views: 34100, likes: 2150, comments: 162, shares: 330, saves: 890, notes: "Paired with Velvet Clay Purifying Mask." },
    { platform: "instagram", publishedAt: getDateAgo(15), format: "reel", topic: "Founder Story: Why I Quit My Job for Clean Skincare", reach: 18900, views: 24300, likes: 1890, comments: 192, shares: 280, saves: 410, notes: "Strong brand connection, high comment rate." },
    { platform: "tiktok", publishedAt: getDateAgo(12), format: "video", topic: "How to Apply Botanical Facial Mist", reach: 16500, views: 21000, likes: 1240, comments: 74, shares: 110, saves: 310, notes: "Quick 15-second refresher tutorial." },
    { platform: "instagram", publishedAt: getDateAgo(9), format: "reel", topic: "Flash 20% Off Weekend Sale Announcement", reach: 15200, views: 19800, likes: 1350, comments: 110, shares: 240, saves: 260, notes: "Promoted with $60 boost." },
    { platform: "tiktok", publishedAt: getDateAgo(6), format: "video", topic: "Real Customer Texture Reaction", reach: 33100, views: 42000, likes: 2940, comments: 205, shares: 480, saves: 980, notes: "High buyer conversion intent in comments." },
    { platform: "instagram", publishedAt: getDateAgo(3), format: "carousel", topic: "Fall Skincare Checklist", reach: 11400, views: 14200, likes: 890, comments: 52, shares: 145, saves: 610, notes: "Saved by 600+ skincare enthusiasts." },
    { platform: "instagram", publishedAt: getDateAgo(1), format: "reel", topic: "Restock Alert: HydraGlow Serum Batch #4", reach: 12800, views: 16400, likes: 1040, comments: 88, shares: 170, saves: 290, notes: "Fresh batch announcement." },
  ];

  const postRefs = [];
  for (const p of postsData) {
    const docRef = await addDoc(collection(db, `workspaces/${workspaceId}/posts`), {
      ...p,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    postRefs.push(docRef.id);
  }

  // 2. Promotions (Instagram boost & TikTok spark ads)
  const promosData = [
    { platform: "instagram", startDate: getDateAgo(27), endDate: getDateAgo(20), spend: 140, currency: "USD", objective: "content_testing", postId: postRefs[0], impressions: 24000, clicks: 420, notes: "Reel boost on Morning Routine." },
    { platform: "tiktok", startDate: getDateAgo(25), endDate: getDateAgo(18), spend: 180, currency: "USD", objective: "qualified_enquiries", postId: postRefs[1], impressions: 38000, clicks: 760, notes: "Spark Ad on Dark Circles hook." },
    { platform: "instagram", startDate: getDateAgo(16), endDate: getDateAgo(10), spend: 120, currency: "USD", objective: "awareness", postId: postRefs[5], impressions: 21000, clicks: 350, notes: "Founder story brand awareness." },
    { platform: "instagram", startDate: getDateAgo(9), endDate: getDateAgo(6), spend: 80, currency: "USD", objective: "orders", postId: postRefs[7], impressions: 16500, clicks: 480, notes: "Weekend flash sale boost." },
    { platform: "tiktok", startDate: getDateAgo(5), endDate: getDateAgo(1), spend: 150, currency: "USD", objective: "orders", postId: postRefs[8], impressions: 31000, clicks: 640, notes: "Customer reaction TikTok campaign." },
  ];

  const promoRefs = [];
  for (const pr of promosData) {
    const docRef = await addDoc(collection(db, `workspaces/${workspaceId}/promotions`), {
      ...pr,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    promoRefs.push(docRef.id);
  }

  // 3. Leads (Inbound Instagram DMs & comments)
  const leadsData = [
    { date: getDateAgo(26), source: "Instagram DM", qualified: true, status: "won", value: 68, notes: "Asked about sensitive eczema-prone skin." },
    { date: getDateAgo(25), source: "TikTok Comment", qualified: true, status: "won", value: 45, notes: "Wanted product link for Dark Circles serum." },
    { date: getDateAgo(23), source: "Instagram DM", qualified: false, status: "lost", value: 30, notes: "Looking for international shipping to UK." },
    { date: getDateAgo(20), source: "Instagram DM", qualified: true, status: "won", value: 92, notes: "Bundle order: Serum + Velvet Mask." },
    { date: getDateAgo(18), source: "TikTok Link-in-Bio", qualified: true, status: "in_conversation", value: 50, notes: "Asked about full ingredient list." },
    { date: getDateAgo(15), source: "Instagram Story Reply", qualified: true, status: "won", value: 75, notes: "Replied to BTS packaging story." },
    { date: getDateAgo(12), source: "Instagram DM", qualified: true, status: "new", value: 40, notes: "Wholesale inquiry for boutique salon." },
    { date: getDateAgo(8), source: "TikTok DM", qualified: true, status: "won", value: 120, notes: "Ordered complete 3-step bundle." },
    { date: getDateAgo(5), source: "Instagram DM", qualified: true, status: "won", value: 85, notes: "Flash sale coupon code query." },
    { date: getDateAgo(2), source: "Instagram DM", qualified: true, status: "in_conversation", value: 60, notes: "Questions on combination skin." },
  ];

  for (const l of leadsData) {
    await addDoc(collection(db, `workspaces/${workspaceId}/leads`), {
      ...l,
      currency: "USD",
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 4. Sales (30+ authentic social orders)
  const salesData = [
    { date: getDateAgo(27), orderNumber: "GA-1021", amount: 68.0, quantity: 2, product: "HydraGlow Vitamin C Serum (x2)", status: "confirmed", promotionId: promoRefs[0], attribution: "manual_reported" },
    { date: getDateAgo(26), orderNumber: "GA-1022", amount: 45.0, quantity: 1, product: "Velvet Clay Purifying Mask", status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(25), orderNumber: "GA-1023", amount: 110.0, quantity: 3, product: "The Glow Trifecta Bundle", status: "confirmed", promotionId: promoRefs[0], attribution: "manual_reported" },
    { date: getDateAgo(24), orderNumber: "GA-1024", amount: 35.0, quantity: 1, product: "Botanical Facial Mist", status: "confirmed", attribution: "unknown" },
    { date: getDateAgo(23), orderNumber: "GA-1025", amount: 68.0, quantity: 2, product: "HydraGlow Serum", status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(22), orderNumber: "GA-1026", amount: 45.0, quantity: 1, product: "Velvet Clay Mask", status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(21), orderNumber: "GA-1027", amount: 92.0, quantity: 2, product: "Serum + Mist Set", status: "confirmed", attribution: "estimated" },
    { date: getDateAgo(20), orderNumber: "GA-1028", amount: 135.0, quantity: 3, product: "Deluxe Radiance Kit", status: "confirmed", promotionId: promoRefs[0], attribution: "manual_reported" },
    { date: getDateAgo(19), orderNumber: "GA-1029", amount: 45.0, quantity: 1, product: "Velvet Clay Mask", status: "confirmed", attribution: "unknown" },
    { date: getDateAgo(18), orderNumber: "GA-1030", amount: 68.0, quantity: 2, product: "HydraGlow Serum", status: "confirmed", promotionId: promoRefs[2], attribution: "manual_reported" },
    { date: getDateAgo(17), orderNumber: "GA-1031", amount: 55.0, quantity: 1, product: "Night Repair Elixir", status: "confirmed", attribution: "estimated" },
    { date: getDateAgo(16), orderNumber: "GA-1032", amount: 110.0, quantity: 3, product: "The Glow Trifecta Bundle", status: "confirmed", promotionId: promoRefs[2], attribution: "manual_reported" },
    { date: getDateAgo(15), orderNumber: "GA-1033", amount: 75.0, quantity: 2, product: "Serum & Mist Duo", status: "confirmed", attribution: "manual_reported" },
    { date: getDateAgo(14), orderNumber: "GA-1034", amount: 68.0, quantity: 2, product: "HydraGlow Serum", status: "confirmed", attribution: "unknown" },
    { date: getDateAgo(13), orderNumber: "GA-1035", amount: 45.0, quantity: 1, product: "Velvet Clay Mask", status: "confirmed", attribution: "estimated" },
    { date: getDateAgo(12), orderNumber: "GA-1036", amount: 165.0, quantity: 4, product: "Boutique Sample Pack", status: "confirmed", attribution: "manual_reported" },
    { date: getDateAgo(11), orderNumber: "GA-1037", amount: 68.0, quantity: 2, product: "HydraGlow Serum", status: "confirmed", attribution: "unknown" },
    { date: getDateAgo(10), orderNumber: "GA-1038", amount: 45.0, quantity: 1, product: "Velvet Clay Mask", status: "confirmed", promotionId: promoRefs[2], attribution: "manual_reported" },
    { date: getDateAgo(9), orderNumber: "GA-1039", amount: 120.0, quantity: 3, product: "Flash Sale Bundle (Promo)", status: "confirmed", promotionId: promoRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(8), orderNumber: "GA-1040", amount: 88.0, quantity: 2, product: "Flash Sale Duos", status: "confirmed", promotionId: promoRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(7), orderNumber: "GA-1041", amount: 110.0, quantity: 3, product: "The Glow Trifecta", status: "confirmed", promotionId: promoRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(6), orderNumber: "GA-1042", amount: 68.0, quantity: 2, product: "HydraGlow Serum", status: "confirmed", promotionId: promoRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(5), orderNumber: "GA-1043", amount: 95.0, quantity: 2, product: "Serum + Night Oil", status: "confirmed", promotionId: promoRefs[4], attribution: "manual_reported" },
    { date: getDateAgo(4), orderNumber: "GA-1044", amount: 45.0, quantity: 1, product: "Velvet Clay Mask", status: "confirmed", promotionId: promoRefs[4], attribution: "manual_reported" },
    { date: getDateAgo(3), orderNumber: "GA-1045", amount: 135.0, quantity: 3, product: "Deluxe Radiance Kit", status: "confirmed", promotionId: promoRefs[4], attribution: "manual_reported" },
    { date: getDateAgo(2), orderNumber: "GA-1046", amount: 68.0, quantity: 2, product: "HydraGlow Serum", status: "confirmed", promotionId: promoRefs[4], attribution: "manual_reported" },
    { date: getDateAgo(1), orderNumber: "GA-1047", amount: 110.0, quantity: 3, product: "The Glow Trifecta", status: "confirmed", promotionId: promoRefs[4], attribution: "manual_reported" },
  ];

  for (const s of salesData) {
    await addDoc(collection(db, `workspaces/${workspaceId}/sales`), {
      ...s,
      currency: "USD",
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 5. Costs (COGS, creator tools, packaging)
  const costsData = [
    { category: "cogs", kind: "percentage", amount: 24, effectiveDate: getDateAgo(30), notes: "Direct botanical formulation & amber bottle packaging costs (24% of sales)." },
    { category: "shipping", kind: "amount", amount: 165, currency: "USD", effectiveDate: getDateAgo(28), notes: "USPS ground advantage shipping supplies & postage labels." },
    { category: "fees", kind: "percentage", amount: 2.9, effectiveDate: getDateAgo(30), notes: "Shopify / Stripe payment processing fee." },
    { category: "other", kind: "amount", amount: 45, currency: "USD", effectiveDate: getDateAgo(25), notes: "CapCut Pro & Canva content editing subscription." },
    { category: "other", kind: "amount", amount: 85, currency: "USD", effectiveDate: getDateAgo(15), notes: "Micro-influencer sample gifting & PR box shipping." },
  ];

  for (const c of costsData) {
    await addDoc(collection(db, `workspaces/${workspaceId}/costs`), {
      ...c,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  console.log("Maya's data seeded successfully! Triggering Decision Engine...");
  await triggerDecisionEngine(user, workspaceId, "rec_maya_seed_001");

  return { email, pass, workspaceId };
}

// =======================================================
// ACCOUNT 2: E-commerce Business Owner (Alex - Apex Gear)
// =======================================================
async function seedAlex() {
  console.log("\n--- Seeding Account 2: E-commerce Business Owner ---");
  const email = "alex.ecommerce@7captur-demo.com";
  const pass = "AlexEcomPass2026!";
  const user = await getOrCreateUser(email, pass);

  const { workspaceId, businessId } = await ensureWorkspace(user, {
    workspaceName: "Apex Gear Outfitters",
    businessName: "Apex Gear Outfitters",
    businessType: "product_seller",
    objective: "profitability",
    buyingMethods: ["website"],
    currency: "USD",
    timezone: "America/Denver",
    country: "US",
    requestId: "seed_alex_init_2026",
  });

  const existingSales = await getDocs(query(collection(db, `workspaces/${workspaceId}/sales`), limit(1)));
  if (existingSales.size > 0) {
    console.log("Alex's workspace already has records, skipping duplication.");
    return { email, pass, workspaceId };
  }

  console.log("Populating extensive e-commerce records...");

  // 1. Promotions (Google Ads PMax & Meta Catalog Ads)
  const promosData = [
    { platform: "google_ads", startDate: getDateAgo(28), endDate: getDateAgo(1), spend: 840, currency: "USD", objective: "orders", campaignId: "gads_pmax_tents_01", impressions: 48000, clicks: 1220, notes: "Google Ads Performance Max - Ultralight Tents & Shelters" },
    { platform: "google_ads", startDate: getDateAgo(25), endDate: getDateAgo(1), spend: 620, currency: "USD", objective: "orders", campaignId: "gads_search_brand_02", impressions: 14500, clicks: 890, notes: "Google Search - Branded & High-Intent Hiking Backpacks" },
    { platform: "instagram", startDate: getDateAgo(26), endDate: getDateAgo(1), spend: 950, currency: "USD", objective: "orders", campaignId: "meta_dpa_apparel_03", impressions: 56000, clicks: 1410, notes: "Meta Dynamic Product Ads - Merino Wool Layering" },
    { platform: "other", startDate: getDateAgo(18), endDate: getDateAgo(5), spend: 280, currency: "USD", objective: "orders", campaignId: "youtube_video_sponsor_04", impressions: 18000, clicks: 310, notes: "Outdoor Gear Review Channel Sponsorship" },
  ];

  const promoRefs = [];
  for (const pr of promosData) {
    const docRef = await addDoc(collection(db, `workspaces/${workspaceId}/promotions`), {
      ...pr,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    promoRefs.push(docRef.id);
  }

  // 2. Posts (Showcasing gear testing & expeditions)
  const postsData = [
    { platform: "instagram", publishedAt: getDateAgo(27), format: "video", topic: "Ridge Line Windstorm Test - Ultralight 2P Tent", reach: 22000, views: 28500, likes: 2100, comments: 142, shares: 380, saves: 710, notes: "Demonstrates 60mph wind resilience." },
    { platform: "instagram", publishedAt: getDateAgo(20), format: "carousel", topic: "Full 12lb Base Weight Gear Loadout for PCT", reach: 18500, views: 23000, likes: 1650, comments: 98, shares: 290, saves: 1140, notes: "High save rate among thru-hikers." },
    { platform: "instagram", publishedAt: getDateAgo(14), format: "video", topic: "Merino Wool vs Synthetic Thermal Guide", reach: 14800, views: 19200, likes: 1180, comments: 76, shares: 140, saves: 480, notes: "Direct product feature highlight." },
    { platform: "instagram", publishedAt: getDateAgo(7), format: "video", topic: "How We Waterproof Our Seams by Hand", reach: 16900, views: 21500, likes: 1420, comments: 85, shares: 190, saves: 390, notes: "Craftsmanship & durability focus." },
  ];

  for (const p of postsData) {
    await addDoc(collection(db, `workspaces/${workspaceId}/posts`), {
      ...p,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 3. Sales (40+ orders with realistic average order values $120-$380)
  const products = [
    { name: "RidgeLite 2-Person Ultralight Tent", price: 349.0 },
    { name: "Summit 48L Frameless Backpack", price: 225.0 },
    { name: "Alpine Merino 260 Thermal Base Hoodie", price: 118.0 },
    { name: "Titanium Cookset & Windburner Stove", price: 84.0 },
    { name: "Trekker Carbon Fiber Trekking Poles", price: 95.0 },
  ];

  for (let i = 28; i >= 1; i--) {
    // 1 to 3 orders per day
    const ordersToday = (i % 3) + 1;
    for (let o = 0; o < ordersToday; o++) {
      const prod = products[(i + o) % products.length];
      const isGooglePmax = (i + o) % 3 === 0;
      const isMeta = (i + o) % 3 === 1;
      const promoId = isGooglePmax ? promoRefs[0] : isMeta ? promoRefs[2] : promoRefs[1];
      const isRefunded = i === 12 && o === 0;

      const saleDoc = {
        date: getDateAgo(i),
        orderNumber: `APX-${8000 + i * 10 + o}`,
        amount: prod.price,
        quantity: 1,
        currency: "USD",
        status: isRefunded ? "refunded" : "confirmed",
        product: prod.name,
        promotionId: promoId,
        attribution: isGooglePmax || isMeta ? "manual_reported" : "estimated",
        workspaceId,
        businessId,
        createdBy: user.uid,
        provenance: "manual",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (isRefunded) {
        saleDoc.refundAmount = prod.price;
      }

      await addDoc(collection(db, `workspaces/${workspaceId}/sales`), saleDoc);
    }
  }

  // 4. Detailed Cost Records (COGS, 3PL Fulfillment, Payment Processing, Warehouse)
  const costsData = [
    { category: "cogs", kind: "percentage", amount: 41, effectiveDate: getDateAgo(30), notes: "Cost of Goods Sold (Fabrics, titanium, seam-tape, manufacturing)." },
    { category: "shipping", kind: "percentage", amount: 7.5, effectiveDate: getDateAgo(30), notes: "Outbound carrier shipping & courier delivery fees (7.5% of net revenue)." },
    { category: "fees", kind: "percentage", amount: 2.9, effectiveDate: getDateAgo(30), notes: "Stripe payment processing fee (2.9% + $0.30)." },
    { category: "fees", kind: "amount", amount: 280, currency: "USD", effectiveDate: getDateAgo(25), notes: "Monthly 3PL warehouse bin storage and pallet fee." },
    { category: "other", kind: "amount", amount: 150, currency: "USD", effectiveDate: getDateAgo(15), notes: "Product liability insurance & quality inspection testing." },
  ];

  for (const c of costsData) {
    await addDoc(collection(db, `workspaces/${workspaceId}/costs`), {
      ...c,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  console.log("Alex's data seeded successfully! Triggering Decision Engine...");
  await triggerDecisionEngine(user, workspaceId, "rec_alex_seed_001");

  return { email, pass, workspaceId };
}

// ============================================================
// ACCOUNT 3: Marketing Firm / Agency (Sarah - Vanguard Growth)
// ============================================================
async function seedSarah() {
  console.log("\n--- Seeding Account 3: Marketing Firm / Agency ---");
  const email = "sarah.agency@7captur-demo.com";
  const pass = "SarahAgencyPass2026!";
  const user = await getOrCreateUser(email, pass);

  const { workspaceId, businessId } = await ensureWorkspace(user, {
    workspaceName: "Vanguard Growth Partners",
    businessName: "Vanguard Growth Partners",
    businessType: "service_provider",
    objective: "qualified_enquiries",
    buyingMethods: ["website", "phone"],
    currency: "USD",
    timezone: "America/Los_Angeles",
    country: "US",
    requestId: "seed_sarah_init_2026",
  });

  const existingLeads = await getDocs(query(collection(db, `workspaces/${workspaceId}/leads`), limit(1)));
  if (existingLeads.size > 0) {
    console.log("Sarah's workspace already has records, skipping duplication.");
    return { email, pass, workspaceId };
  }

  console.log("Populating extensive agency records...");

  // 1. Promotions (LinkedIn InMail & Google Search B2B Ads)
  const promosData = [
    { platform: "google_ads", startDate: getDateAgo(28), endDate: getDateAgo(1), spend: 750, currency: "USD", objective: "qualified_enquiries", campaignId: "gads_b2b_fractional_cmo", impressions: 8500, clicks: 310, notes: "Search targeting 'B2B growth agency' and 'Fractional CMO for SaaS'" },
    { platform: "other", startDate: getDateAgo(25), endDate: getDateAgo(1), spend: 920, currency: "USD", objective: "qualified_enquiries", campaignId: "li_sponsored_inmail_audit", impressions: 16200, clicks: 420, notes: "LinkedIn Sponsored InMail targeting VP Marketing & Series A/B Founders" },
    { platform: "other", startDate: getDateAgo(15), endDate: getDateAgo(5), spend: 350, currency: "USD", objective: "awareness", campaignId: "webinar_q4_cac_playbook", impressions: 22000, clicks: 680, notes: "Webinar Lead-Gen: Lowering Customer Acquisition Cost in 2026" },
  ];

  const promoRefs = [];
  for (const pr of promosData) {
    const docRef = await addDoc(collection(db, `workspaces/${workspaceId}/promotions`), {
      ...pr,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    promoRefs.push(docRef.id);
  }

  // 2. High-Value Inbound Commercial Enquiries / Leads (20+ qualified prospects)
  const leadsData = [
    { date: getDateAgo(26), source: "LinkedIn InMail", qualified: true, status: "won", value: 6500, notes: "Fintech SaaS ($12M ARR). Needs paid search & Meta funnel audit." },
    { date: getDateAgo(24), source: "Google Ads", qualified: true, status: "won", value: 4500, notes: "B2B Logistics platform. Conversion rate optimization sprint." },
    { date: getDateAgo(22), source: "Website Inbound", qualified: true, status: "in_conversation", value: 8000, notes: "Healthcare SaaS. Discovery call booked with VP Growth." },
    { date: getDateAgo(20), source: "LinkedIn InMail", qualified: false, status: "lost", value: 2000, notes: "Pre-seed founder with <$5k monthly ad budget. Disqualified." },
    { date: getDateAgo(18), source: "Google Ads", qualified: true, status: "won", value: 12000, notes: "Enterprise DevTools client. 3-month Fractional CMO retainer." },
    { date: getDateAgo(16), source: "Webinar Inbound", qualified: true, status: "in_conversation", value: 5500, notes: "Attended Q4 CAC webinar. Requested attribution model review." },
    { date: getDateAgo(14), source: "Website Inbound", qualified: true, status: "won", value: 7500, notes: "Cybersecurity startup. Full performance marketing retainer." },
    { date: getDateAgo(11), source: "LinkedIn InMail", qualified: true, status: "new", value: 6000, notes: "Inbound inquiry regarding attribution tracking and Shopify." },
    { date: getDateAgo(9), source: "Google Ads", qualified: true, status: "in_conversation", value: 9500, notes: "E-commerce aggregator looking for multi-brand media buying." },
    { date: getDateAgo(6), source: "Website Inbound", qualified: true, status: "won", value: 5000, notes: "B2B HR Tech. Landing page sprint & Google Ads setup." },
    { date: getDateAgo(3), source: "LinkedIn InMail", qualified: true, status: "new", value: 7000, notes: "Series A EdTech startup founder discovery request." },
    { date: getDateAgo(1), source: "Google Ads", qualified: true, status: "new", value: 8500, notes: "SaaS CRM company looking to scale beyond $20k/mo ad spend." },
  ];

  const leadRefs = [];
  for (const l of leadsData) {
    const docRef = await addDoc(collection(db, `workspaces/${workspaceId}/leads`), {
      ...l,
      currency: "USD",
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    leadRefs.push(docRef.id);
  }

  // 3. Sales / Invoiced Client Retainers ($4,500 - $12,000 contracts)
  const salesData = [
    { date: getDateAgo(24), orderNumber: "VGP-INV-2041", amount: 6500.0, product: "Growth Diagnostic & Paid Search Restructure", status: "confirmed", promotionId: promoRefs[1], leadId: leadRefs[0], attribution: "manual_reported" },
    { date: getDateAgo(22), orderNumber: "VGP-INV-2042", amount: 4500.0, product: "Landing Page CRO & Funnel Optimization Sprint", status: "confirmed", promotionId: promoRefs[0], leadId: leadRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(16), orderNumber: "VGP-INV-2043", amount: 12000.0, product: "Quarterly Fractional CMO & Growth Management Retainer", status: "confirmed", promotionId: promoRefs[0], leadId: leadRefs[4], attribution: "manual_reported" },
    { date: getDateAgo(12), orderNumber: "VGP-INV-2044", amount: 7500.0, product: "Performance Media Buying & Attribution Setup", status: "confirmed", leadId: leadRefs[6], attribution: "manual_reported" },
    { date: getDateAgo(5), orderNumber: "VGP-INV-2045", amount: 5000.0, product: "B2B Paid Acquisition Sprint (Month 1)", status: "confirmed", leadId: leadRefs[9], attribution: "manual_reported" },
  ];

  for (const s of salesData) {
    await addDoc(collection(db, `workspaces/${workspaceId}/sales`), {
      ...s,
      currency: "USD",
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  // 4. Agency Costs (Software stack, contract media buyers/copywriters)
  const costsData = [
    { category: "other", kind: "amount", amount: 890, currency: "USD", effectiveDate: getDateAgo(30), notes: "Agency MarTech software stack (HubSpot CRM, SEMrush, Loom, Notion)." },
    { category: "cogs", kind: "amount", amount: 3200, currency: "USD", effectiveDate: getDateAgo(25), notes: "Senior Technical Copywriter & Ad Creative Contractor Deliverables." },
    { category: "cogs", kind: "amount", amount: 2800, currency: "USD", effectiveDate: getDateAgo(15), notes: "Landing page design and Webflow developer implementation." },
    { category: "fees", kind: "percentage", amount: 2.2, effectiveDate: getDateAgo(30), notes: "ACH and corporate card invoicing fee." },
  ];

  for (const c of costsData) {
    await addDoc(collection(db, `workspaces/${workspaceId}/costs`), {
      ...c,
      workspaceId,
      businessId,
      createdBy: user.uid,
      provenance: "manual",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  console.log("Sarah's data seeded successfully! Triggering Decision Engine...");
  await triggerDecisionEngine(user, workspaceId, "rec_sarah_seed_001");

  return { email, pass, workspaceId };
}

async function main() {
  console.log("Starting 7Captur 3 Demo Accounts Seeding...");
  const a1 = await seedMaya();
  const a2 = await seedAlex();
  const a3 = await seedSarah();

  console.log("\n=======================================================");
  console.log("  3 DEMO ACCOUNTS CREATED & POPULATED SUCCESSFULLY");
  console.log("=======================================================");
  console.log("1) SOCIAL SELLER:");
  console.log(`   Email:    ${a1.email}`);
  console.log(`   Password: ${a1.pass}`);
  console.log(`   Workspace: GlowAura Social Boutique (${a1.workspaceId})`);
  console.log(`   Data: 11 posts, 5 promotions, 10 enquiries, 27 sales, 5 cost lines`);
  console.log("-------------------------------------------------------");
  console.log("2) E-COMMERCE BUSINESS OWNER:");
  console.log(`   Email:    ${a2.email}`);
  console.log(`   Password: ${a2.pass}`);
  console.log(`   Workspace: Apex Gear Outfitters (${a2.workspaceId})`);
  console.log(`   Data: Google Ads & Meta DPA campaigns, 45+ orders, COGS, 3PL costs`);
  console.log("-------------------------------------------------------");
  console.log("3) MARKETING FIRM / AGENCY:");
  console.log(`   Email:    ${a3.email}`);
  console.log(`   Password: ${a3.pass}`);
  console.log(`   Workspace: Vanguard Growth Partners (${a3.workspaceId})`);
  console.log(`   Data: LinkedIn & Search ads, 12 high-ticket leads, 5 contracts ($35k+)`);
  console.log("=======================================================\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed script failed:", err);
  process.exit(1);
});
