// ============================================================
// MODULE: Results & Podium
// Handles: Rankings, leaderboard, category filtering
// ============================================================
import { db, collection, getDocs, query, where, orderBy, onSnapshot }
  from '../firebase-config.js';

// ── Get all scores ranked ─────────────────────────────────────
export async function getRankings(categoryFilter = null) {
  try {
    let q;
    if (categoryFilter) {
      q = query(
        collection(db, 'scores'),
        where('category', '==', categoryFilter),
        orderBy('totalScore', 'desc')
      );
    } else {
      q = query(
        collection(db, 'scores'),
        orderBy('totalScore', 'desc')
      );
    }
    const snap = await getDocs(q);
    return snap.docs.map((d, index) => ({
      id: d.id,
      rank: index + 1,
      ...d.data(),
    }));
  } catch (err) {
    console.error('getRankings error:', err);
    return [];
  }
}

// ── Subscribe to live leaderboard ─────────────────────────────
export function subscribeLeaderboard(callback, categoryFilter = null) {
  let q;
  if (categoryFilter) {
    q = query(
      collection(db, 'scores'),
      where('category', '==', categoryFilter),
      orderBy('totalScore', 'desc')
    );
  } else {
    q = query(
      collection(db, 'scores'),
      orderBy('totalScore', 'desc')
    );
  }
  return onSnapshot(q, (snap) => {
    const results = snap.docs.map((d, index) => ({
      id: d.id,
      rank: index + 1,
      ...d.data(),
    }));
    callback(results);
  });
}

// ── Get podium (top 3) ────────────────────────────────────────
export function getPodium(rankings) {
  return rankings.slice(0, 3).map((item, index) => ({
    ...item,
    medal: index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉',
    podiumClass: index === 0 ? 'gold' : index === 1 ? 'silver' : 'bronze',
  }));
}

// ── Category stats ────────────────────────────────────────────
export function getCategoryStats(rankings) {
  const stats = {};
  rankings.forEach(r => {
    const cat = r.category || 'SIN_CAT';
    if (!stats[cat]) {
      stats[cat] = { count: 0, totalScore: 0, avgScore: 0, topScore: 0 };
    }
    stats[cat].count++;
    stats[cat].totalScore += r.totalScore || 0;
    stats[cat].topScore = Math.max(stats[cat].topScore, r.totalScore || 0);
    stats[cat].avgScore = Math.round(stats[cat].totalScore / stats[cat].count);
  });
  return stats;
}
