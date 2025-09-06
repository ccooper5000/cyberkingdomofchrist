// scripts/seed.ts
import dotenv from 'dotenv';
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH || '.env.scripts' });
import { createClient, SupabaseClient } from '@supabase/supabase-js';

type UUID = string;

const url = process.env.SUPABASE_URL;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRole) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Create a local .env.scripts file.');
  process.exit(1);
}

const admin = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------- helpers ----------

function computeOfficeTitle(opts: {
  level?: 'federal' | 'state' | 'local' | null;
  chamber?: string | null;
  state?: string | null;   // 2-letter, e.g. TX
  district?: string | null;
}) {
  const level = (opts.level ?? '').toLowerCase();
  const chamber = (opts.chamber ?? '').toLowerCase();
  const st = (opts.state ?? '').toUpperCase();
  const m = (opts.district ?? '').match(/\d+/);
  const n = m ? m[0] : null;

  if (level === 'federal') {
    if (chamber === 'senate') return `U.S. Senate (${st || 'US'})`;
    if (chamber === 'house' && n) return `U.S. House (${st || 'US'}-${n})`;
    if (chamber === 'executive') return `President of the United States`;
    return `U.S. Congress (${st || 'US'})`;
  }
  if (level === 'state') {
    if (chamber === 'senate' && n) return `${st} State Senate (SD-${n})`;
    if (chamber === 'house' && n) return `${st} State House (HD-${n})`;
    return `${st} State Legislature`;
  }
  return `${st || 'US'} Local Office`;
}

function computeOcdDivision(opts: {
  level?: 'federal' | 'state' | 'local' | null;
  chamber?: string | null;
  state?: string | null;   // 2-letter (e.g., TX)
  district?: string | null;
}) {
  const level = (opts.level ?? '').toLowerCase();
  const chamber = (opts.chamber ?? '').toLowerCase();
  const st = (opts.state ?? '').toLowerCase();
  const raw = opts.district ?? '';

  const m = raw.match(/\d+/);
  const n = m ? m[0] : null;

  if (!st) return 'ocd-division/country:us';

  if (level === 'federal') {
    if (chamber === 'house' && n) return `ocd-division/country:us/state:${st}/cd:${n}`;
    if (chamber === 'senate') return `ocd-division/country:us/state:${st}`;
    if (chamber === 'executive') return 'ocd-division/country:us';
    return `ocd-division/country:us/state:${st}`;
  }

  if (level === 'state') {
    if (chamber === 'house' && n) return `ocd-division/country:us/state:${st}/sldl:${n}`;
    if (chamber === 'senate' && n) return `ocd-division/country:us/state:${st}/sldu:${n}`;
    return `ocd-division/country:us/state:${st}`;
  }

  return `ocd-division/country:us/state:${st}`;
}

async function ensurePresidentRep() {
  const { data, error } = await admin
    .from('representatives')
    .upsert(
      {
        level: 'federal',
        chamber: 'executive',
        name: 'President of the United States',
        party: null,
        state: null,
        district: null,
        email: null,
        phone: null,
        division_id: 'ocd-division/country:us',
        office: 'President of the United States',
        source: 'manual',
      },
      { onConflict: 'level,chamber' }
    )
    .select('id')
    .single();

  if (error) throw error;
  return data.id as string;
}

async function findUserIdByEmail(client: SupabaseClient, email: string): Promise<UUID | null> {
  let page = 1;
  const perPage = 100;
  while (page <= 10) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (match) return match.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function getOrCreateUser(opts: {
  email: string;
  password: string;
  username: string;
  display_name: string;
}) {
  const { email, password, username, display_name } = opts;

  const created = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, display_name },
  });

  let userId: UUID | null = null;

  if (created.error) {
    userId = await findUserIdByEmail(admin, email);
    if (!userId) {
      console.error('Failed to create or find user:', email, created.error);
      throw created.error;
    }
  } else {
    userId = created.data.user.id;
  }

  const { error: profErr } = await admin.from('profiles').upsert(
    {
      id: userId,
      username,
      display_name,
      avatar_url: null,
      phone: null,
    },
    { onConflict: 'id' }
  );
  if (profErr) throw profErr;

  return userId;
}

async function upsertPrimaryAddress(userId: UUID, addr: {
  line1: string; line2?: string | null; city: string; state: string; postal_code: string;
  country?: string | null; cd?: string | null; sd?: string | null; hd?: string | null; muni?: string | null;
}) {
  const { data: existing, error: selErr } = await admin
    .from('user_addresses')
    .select('id')
    .eq('user_id', userId)
    .eq('is_primary', true)
    .maybeSingle();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;

  if (existing?.id) {
    const { error } = await admin.from('user_addresses').update({
      line1: addr.line1,
      line2: addr.line2 ?? null,
      city: addr.city,
      state: addr.state,
      postal_code: addr.postal_code,
      country: addr.country ?? 'US',
      cd: addr.cd ?? null, sd: addr.sd ?? null, hd: addr.hd ?? null, muni: addr.muni ?? null,
      is_primary: true,
    }).eq('id', existing.id);
    if (error) throw error;
    return existing.id as UUID;
  } else {
    const { data, error } = await admin.from('user_addresses').insert({
      user_id: userId,
      line1: addr.line1,
      line2: addr.line2 ?? null,
      city: addr.city,
      state: addr.state,
      postal_code: addr.postal_code,
      country: addr.country ?? 'US',
      cd: addr.cd ?? null, sd: addr.sd ?? null, hd: addr.hd ?? null, muni: addr.muni ?? null,
      is_primary: true,
    }).select('id').single();
    if (error) throw error;
    return data.id as UUID;
  }
}

async function getOrCreateRepresentative(rep: {
  level: 'federal' | 'state' | 'local';
  chamber?: string | null;
  name: string;
  party?: string | null;
  state?: string | null;
  district?: string | null;
  email?: string | null;
  phone?: string | null;
  twitter?: string | null;
  facebook?: string | null;
}) {
  const division_id = computeOcdDivision({
    level: rep.level,
    chamber: rep.chamber ?? null,
    state: rep.state ?? null,
    district: rep.district ?? null,
  });
  const office = computeOfficeTitle({
    level: rep.level,
    chamber: rep.chamber ?? null,
    state: rep.state ?? null,
    district: rep.district ?? null,
  });

  const { data: existing, error: selErr } = await admin
    .from('representatives')
    .select('id')
    .eq('name', rep.name)
    .eq('division_id', division_id)
    .maybeSingle();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;

  if (existing?.id) return existing.id as UUID;

  const { data, error } = await admin.from('representatives').insert({
    level: rep.level,
    chamber: rep.chamber ?? null,
    name: rep.name,
    party: rep.party ?? null,
    state: rep.state ?? null,
    district: rep.district ?? null,
    email: rep.email ?? null,
    phone: rep.phone ?? null,
    twitter: rep.twitter ?? null,
    facebook: rep.facebook ?? null,
    division_id,
    source: 'manual',
    office,
  }).select('id').single();
  if (error) throw error;
  console.log('President rep ensured with id:', data.id);
  return data.id as UUID;
}

async function linkUserRep(userId: UUID, repId: UUID) {
  const { data: repRow, error: repErr } = await admin
    .from('representatives')
    .select('level')
    .eq('id', repId)
    .maybeSingle();
  if (repErr) throw repErr;

  const level: string = (repRow?.level as string) ?? 'local';

  const { error } = await admin.from('user_representatives').upsert(
    { user_id: userId, rep_id: repId, level, is_favorite: false },
    { onConflict: 'user_id,rep_id' }
  );
  if (error) throw error;
}

async function getOrCreatePrayer(p: {
  author_id: UUID;
  category: 'trump_politics' | 'health' | 'family' | 'business' | 'national' | 'custom';
  content: string;
  visibility?: 'public' | 'group' | 'circle';
  group_id?: UUID | null;
  circle_id?: UUID | null;
  is_featured?: boolean;
}) {
  const { data: existing, error: selErr } = await admin
    .from('prayers')
    .select('id')
    .eq('author_id', p.author_id)
    .eq('content', p.content)
    .maybeSingle();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing?.id) return existing.id as UUID;

  const { data, error } = await admin.from('prayers').insert({
    author_id: p.author_id,
    category: p.category,
    content: p.content,
    visibility: p.visibility ?? 'public',
    group_id: p.group_id ?? null,
    circle_id: p.circle_id ?? null,
    is_featured: !!p.is_featured,
  }).select('id').single();
  if (error) throw error;
  return data.id as UUID;
}

async function ensureLike(prayer_id: UUID, user_id: UUID) {
  const { error } = await admin.from('prayer_likes').upsert({ prayer_id, user_id });
  if (error) throw error;
}

async function ensureComment(prayer_id: UUID, author_id: UUID, content: string) {
  const { data: existing, error: selErr } = await admin
    .from('prayer_comments')
    .select('id')
    .eq('prayer_id', prayer_id)
    .eq('author_id', author_id)
    .eq('content', content)
    .maybeSingle();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing?.id) return existing.id as UUID;

  const { data, error } = await admin.from('prayer_comments').insert({
    prayer_id,
    author_id,
    content,
  }).select('id').single();
  if (error) throw error;
  return data.id as UUID;
}

async function enqueueOutreach(user_id: UUID, prayer_id: UUID, rep_id: UUID, channels: string[] = ['email']) {
  const { data: existing, error: selErr } = await admin
    .from('outreach_requests')
    .select('id')
    .eq('user_id', user_id)
    .eq('prayer_id', prayer_id)
    .eq('target_rep_id', rep_id)
    .maybeSingle();
  if (selErr && selErr.code !== 'PGRST116') throw selErr;
  if (existing?.id) return existing.id as UUID;

  const { data, error } = await admin.from('outreach_requests').insert({
    user_id, prayer_id, target_rep_id: rep_id, channels, status: 'queued',
  }).select('id').single();
  if (error) throw error;
  return data.id as UUID;
}

// ---------- main ----------
async function main() {
  console.log('Seeding CyberKingdomOfChrist demo data...');

  const aliceId = await getOrCreateUser({
    email: 'alice@ckoc.test',
    password: 'Passw0rd!',
    username: 'alice',
    display_name: 'Alice Faith',
  });
  const bobId = await getOrCreateUser({
    email: 'bob@ckoc.test',
    password: 'Passw0rd!',
    username: 'bob',
    display_name: 'Bob Prayer',
  });
  console.log('Users:', { aliceId, bobId });

  await upsertPrimaryAddress(aliceId, {
    line1: '1100 Congress Ave',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
  });
  await upsertPrimaryAddress(bobId, {
    line1: '401 W 2nd St',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
  });

  // ✅ Ensure the President row exists here
  await ensurePresidentRep();

  const senTX = await getOrCreateRepresentative({
    level: 'federal', chamber: 'senate', name: 'Jane Example', party: 'R', state: 'TX', district: null,
    email: 'jane@example.gov', phone: '512-555-0101', twitter: 'senJaneExample', facebook: 'senJaneExample'
  });
  const repTXHD = await getOrCreateRepresentative({
    level: 'state', chamber: 'house', name: 'John Example', party: 'R', state: 'TX', district: 'HD-49',
    email: 'john@example.tx.gov', phone: '512-555-0102', twitter: 'repJohnExample', facebook: 'repJohnExample'
  });

  await linkUserRep(aliceId, senTX);
  await linkUserRep(aliceId, repTXHD);

  const p1 = await getOrCreatePrayer({
    author_id: aliceId,
    category: 'national',
    content: 'Praying for wisdom and unity across our nation.',
    is_featured: true,
  });
  const p2 = await getOrCreatePrayer({
    author_id: aliceId,
    category: 'family',
    content: 'Covering families in protection and peace this week.',
  });
  const p3 = await getOrCreatePrayer({
    author_id: bobId,
    category: 'trump_politics',
    content: 'Praying for righteous leadership and justice.',
  });

  await ensureLike(p1, bobId);
  await ensureLike(p2, bobId);
  await ensureComment(p1, bobId, 'Amen! Agreeing in prayer.');
  await ensureComment(p3, aliceId, 'Standing with you in faith.');

  await enqueueOutreach(aliceId, p1, senTX, ['email']);

  console.log('✅ Seed complete.');
}

main().catch((e) => {
  console.error('Seed failed:', e);
  process.exit(1);
});
