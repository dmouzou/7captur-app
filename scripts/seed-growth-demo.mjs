// Seed script for dedicated Growth Tier Demo Account
// Run with: node scripts/seed-growth-demo.mjs

import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword } from "firebase/auth";
import { getFirestore, collection, addDoc, serverTimestamp, getDocs, query, limit } from "firebase/firestore";

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
    console.log(`createWorkspace notice:`, err.message);
  }

  if (!bizId) {
    const bizSnap = await getDocs(query(collection(db, `workspaces/${wsId}/businesses`), limit(1)));
    bizId = bizSnap.docs[0]?.id;
  }

  console.log(`Workspace ready: ${wsId} (business: ${bizId})`);
  return { workspaceId: wsId, businessId: bizId };
}

function getDateAgo(daysAgo) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function triggerDecisionEngine(user, workspaceId, businessId, requestId) {
  try {
    const token = await user.getIdToken(true);
    const res = await fetch("https://us-central1-captur-app-dev.cloudfunctions.net/generateRecommendation", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ data: { workspaceId, businessId, requestId, overrideSafetyNet: true } }),
    });
    const json = await res.json();
    if (json.error) {
      console.log(`Decision Engine trigger notice: ${json.error.message}`);
    } else {
      console.log(`Decision Engine recommendation generated successfully!`);
    }
  } catch (err) {
    console.log(`Decision Engine trigger: ${err.message}`);
  }
}

async function run() {
  const email = "growth.demo@7captur-demo.com";
  const pass = "GrowthPass2026!";
  console.log(`Signing in ${email}...`);
  const cred = await signInWithEmailAndPassword(auth, email, pass);
  const user = cred.user;

  console.log("Creating workspace for Growth Demo...");
  const { workspaceId, businessId } = await ensureWorkspace(user, {
    workspaceName: "OmniScale Brands",
    businessName: "OmniScale Direct",
    businessType: "product_seller",
    objective: "profitability",
    buyingMethods: ["website"],
    currency: "USD",
    timezone: "America/New_York",
    country: "US",
    requestId: "growth_demo_init_2026",
  });

  console.log("Adding commercial records...");

  // 1. Marketing Posts
  const postsData = [
    { platform: "instagram", publishedAt: getDateAgo(26), format: "reel", topic: "Product Teardown & Quality Test", reach: 22400, views: 28900, likes: 2100, comments: 142, shares: 380, saves: 510, notes: "Top organic post of the month." },
    { platform: "tiktok", publishedAt: getDateAgo(22), format: "video", topic: "Customer Unboxing & First Impression", reach: 48900, views: 61000, likes: 4500, comments: 310, shares: 720, saves: 1100, notes: "Strong conversion driver to Shopify." },
    { platform: "instagram", publishedAt: getDateAgo(18), format: "carousel", topic: "5 Reasons Customers Switch to Us", reach: 16800, views: 19500, likes: 1350, comments: 88, shares: 210, saves: 640, notes: "High save-to-reach ratio." },
    { platform: "meta", publishedAt: getDateAgo(14), format: "image", topic: "Weekend Flash Sale 25% Off", reach: 31000, views: 36000, likes: 1980, comments: 160, shares: 410, saves: 320, notes: "Paired with catalog ads." },
    { platform: "tiktok", publishedAt: getDateAgo(8), format: "video", topic: "Behind The Scenes: Warehouse Fulfillment", reach: 29500, views: 34000, likes: 2400, comments: 130, shares: 290, saves: 430, notes: "Builds brand credibility." },
    { platform: "instagram", publishedAt: getDateAgo(3), format: "reel", topic: "New Fall Colorway Release", reach: 27800, views: 33500, likes: 2600, comments: 210, shares: 450, saves: 780, notes: "Immediate lift in cart additions." },
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

  // 2. Promotions
  const promosData = [
    { platform: "meta", startDate: getDateAgo(25), endDate: getDateAgo(18), spend: 850, currency: "USD", objective: "orders", postId: postRefs[0], impressions: 94000, clicks: 1850, notes: "Scale testing on top video creative." },
    { platform: "googleads", startDate: getDateAgo(24), endDate: getDateAgo(10), spend: 1200, currency: "USD", objective: "orders", impressions: 142000, clicks: 3100, notes: "PMax and Brand Search high-intent traffic." },
    { platform: "tiktok", startDate: getDateAgo(17), endDate: getDateAgo(7), spend: 650, currency: "USD", objective: "qualified_enquiries", postId: postRefs[1], impressions: 78000, clicks: 1420, notes: "Spark Ad on unboxing video." },
    { platform: "meta", startDate: getDateAgo(12), endDate: getDateAgo(5), spend: 950, currency: "USD", objective: "orders", postId: postRefs[3], impressions: 110000, clicks: 2200, notes: "Flash sale DPA retargeting." },
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

  // 3. Leads & Enquiries
  const leadsData = [
    { date: getDateAgo(24), source: "Website Chat", qualified: true, status: "won", value: 185, notes: "Asked about custom bundle discount." },
    { date: getDateAgo(21), source: "Instagram DM", qualified: true, status: "won", value: 240, notes: "Order assistance for high-tier SKU." },
    { date: getDateAgo(18), source: "Email Inquiry", qualified: true, status: "won", value: 450, notes: "Corporate gift order enquiry." },
    { date: getDateAgo(15), source: "TikTok DM", qualified: true, status: "won", value: 160, notes: "Sizing and delivery timeline inquiry." },
    { date: getDateAgo(12), source: "Website Form", qualified: false, status: "lost", value: 80, notes: "Unsupported international region." },
    { date: getDateAgo(9), source: "Instagram DM", qualified: true, status: "won", value: 290, notes: "Flash sale checkout assistance." },
    { date: getDateAgo(5), source: "Website Chat", qualified: true, status: "won", value: 310, notes: "Pre-order question answered." },
    { date: getDateAgo(2), source: "Instagram Story Reply", qualified: true, status: "in_conversation", value: 175, notes: "Fall colorway restock timing." },
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

  // 4. Sales & Revenue
  const salesData = [
    { date: getDateAgo(24), orderNumber: "ORD-9401", amount: 245.0, status: "confirmed", promotionId: promoRefs[0], leadId: leadRefs[0], attribution: "manual_reported" },
    { date: getDateAgo(23), orderNumber: "ORD-9402", amount: 180.0, status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(22), orderNumber: "ORD-9403", amount: 390.0, status: "confirmed", promotionId: promoRefs[0], attribution: "manual_reported" },
    { date: getDateAgo(21), orderNumber: "ORD-9404", amount: 520.0, status: "confirmed", promotionId: promoRefs[1], leadId: leadRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(20), orderNumber: "ORD-9405", amount: 210.0, status: "confirmed", promotionId: promoRefs[0], attribution: "manual_reported" },
    { date: getDateAgo(19), orderNumber: "ORD-9406", amount: 315.0, status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(18), orderNumber: "ORD-9407", amount: 480.0, status: "confirmed", leadId: leadRefs[2], attribution: "manual_reported" },
    { date: getDateAgo(16), orderNumber: "ORD-9408", amount: 620.0, status: "confirmed", promotionId: promoRefs[2], attribution: "manual_reported" },
    { date: getDateAgo(15), orderNumber: "ORD-9409", amount: 295.0, status: "confirmed", promotionId: promoRefs[1], leadId: leadRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(14), orderNumber: "ORD-9410", amount: 410.0, status: "confirmed", promotionId: promoRefs[2], attribution: "manual_reported" },
    { date: getDateAgo(12), orderNumber: "ORD-9411", amount: 380.0, status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(11), orderNumber: "ORD-9412", amount: 540.0, status: "confirmed", promotionId: promoRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(10), orderNumber: "ORD-9413", amount: 750.0, status: "confirmed", promotionId: promoRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(9), orderNumber: "ORD-9414", amount: 460.0, status: "confirmed", promotionId: promoRefs[3], leadId: leadRefs[5], attribution: "manual_reported" },
    { date: getDateAgo(8), orderNumber: "ORD-9415", amount: 320.0, status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(7), orderNumber: "ORD-9416", amount: 680.0, status: "confirmed", promotionId: promoRefs[3], attribution: "manual_reported" },
    { date: getDateAgo(5), orderNumber: "ORD-9417", amount: 510.0, status: "confirmed", promotionId: promoRefs[1], leadId: leadRefs[6], attribution: "manual_reported" },
    { date: getDateAgo(4), orderNumber: "ORD-9418", amount: 430.0, status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(3), orderNumber: "ORD-9419", amount: 590.0, status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
    { date: getDateAgo(2), orderNumber: "ORD-9420", amount: 375.0, status: "confirmed", promotionId: promoRefs[1], attribution: "manual_reported" },
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

  // 5. Costs
  const costsData = [
    { category: "cogs", kind: "percentage", amount: 34, effectiveDate: getDateAgo(30), notes: "Product COGS (materials, assembly, packaging)." },
    { category: "shipping", kind: "amount", amount: 1450, currency: "USD", effectiveDate: getDateAgo(25), notes: "Monthly 3PL warehouse pick, pack and freight." },
    { category: "software", kind: "amount", amount: 480, currency: "USD", effectiveDate: getDateAgo(30), notes: "Shopify Advanced, Klaviyo, Gorgias, Recharge." },
    { category: "fees", kind: "percentage", amount: 2.9, effectiveDate: getDateAgo(30), notes: "Payment gateway processing fee." },
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

  console.log("Triggering Decision Engine for Growth demo account...");
  await triggerDecisionEngine(user, workspaceId, businessId, "growth_demo_rec_001");

  console.log("\nGrowth Demo Data Populated Successfully!");
  console.log(`User UID: ${user.uid}`);
  console.log(`Workspace ID: ${workspaceId}`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Error seeding growth demo:", err);
  process.exit(1);
});

