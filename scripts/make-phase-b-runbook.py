#!/usr/bin/env python3
"""Generate the Phase B runbook as a single self-contained local HTML page.

    cd <repo root> && python3 scripts/make-phase-b-runbook.py

Writes ~/Downloads/sonario-phase-b-runbook.html — open it by double-clicking. No server, no
hosting, no network. Nina asked for it local and private, so it is a file rather than an Artifact.

WHY GENERATE IT rather than hand-write the HTML: every Copy/Select button carries the EXACT text
of the committed migration, read from supabase/ at build time. A hand-maintained page would drift
from the migrations the moment one changed, and a runbook that hands you almost-right SQL is worse
than no runbook. Re-run this after touching anything under supabase/.

ON THE TWO BUTTONS PER BLOCK. Copy tries the clipboard API and falls back to execCommand. Select
puts the whole block in the browser selection so ⌘C works with no permissions at all. Select
exists because testing found the clipboard refused in contexts the page cannot detect or fix
(a secure origin whose document simply isn't focused), and the runbook must not depend on it.
"""
import json, os

def read(p):
    with open(os.path.join('supabase', p)) as f:
        return f.read()

MIG = ['0000_schema_and_grants.sql', '0001_foundation.sql', '0002_events_and_privacy.sql',
       '0003_checkin_undo_window.sql', '0004_signup_trigger_skips_anonymous.sql',
       '0005_members_can_actually_cancel_leave.sql', '0006_voice_parts.sql',
       '0007_grant_sweep_and_revokes.sql']

MIG_NOTE = {
  '0000': ('Schema + API grants',
           'Creates the <code>sonario</code> schema and the grants the rest of the chain assumes. Without this, 0001 fails on its first <code>create table</code>.'),
  '0001': ('Foundation — 18 tables, 8 functions, 39 policies',
           'The big one. Everything else builds on it. Also creates the <code>on_auth_user_created</code> trigger on <code>auth.users</code>.'),
  '0002': ('Unified event model + away_dates privacy',
           'Adds <code>event_type</code>, <code>counts_towards_attendance</code>, <code>title</code>, <code>description</code>, and replaces the permissive away-dates read policy.'),
  '0003': ('Check-in: one-hour undo window',
           'Server-side timestamp trigger, plus check-in-only-on-today and undo-within-an-hour policies.'),
  '0004': ('Signup trigger skips anonymous identities',
           'The fix for Page Turners visitors filling Sonario’s approval queue. Still correct on a dedicated project, and it is why the Leave Test identity has to be created by hand later.'),
  '0005': ('Members can actually cancel leave',
           'Adds the missing <code>WITH CHECK</code>. Without it the cancel-leave policy is structurally impossible to satisfy.'),
  '0006': ('Voice parts',
           'Adds <code>sop_1</code>/<code>sop_2</code>, the <code>common</code> flag, and the partial unique index enforcing one live part per person per song.'),
  '0007': ('Grant sweep + explicit revokes + verification',
           'Always last. Sweeps grants, then takes back what the sweep should not have given away, then prints a verdict per function.'),
}

blocks = {f'mig{m[:4]}': read('migrations/' + m) for m in MIG}
blocks['promote'] = """-- Promote Nina to active/super. Looks her id up by email rather than assuming a UUID.
update sonario.memberships m
set status = 'active', role = 'super', decided_at = now(), decided_by = m.profile_id
where m.profile_id = (select id from auth.users
                      where email = 'ninakowalski1997@gmail.com' and not coalesce(is_anonymous, false))
returning m.profile_id, m.status, m.role;"""
blocks['anon_console'] = """await supabase.auth.signInAnonymously()
// then read the id:
(await supabase.auth.getUser()).data.user.id"""
blocks['leavetest'] = """-- Paste the anonymous uuid from the console into BOTH places below.
insert into sonario.profiles (id, display_name, google_email)
values ('PASTE-ANON-UUID-HERE', 'Leave Test', '')
on conflict (id) do nothing;

insert into sonario.memberships (profile_id, status, role, decided_at)
values ('PASTE-ANON-UUID-HERE', 'active', 'member', now())
on conflict (profile_id) do update set status = 'active', role = 'member';"""
blocks['whoexists'] = """select p.display_name,
       coalesce(nullif(p.google_email, ''), '(none)') as email,
       m.status, m.role,
       case
         when p.id::text like 'f0000000-0000-0000-0000-%' then 'seeded fake'
         when u.is_anonymous then 'anonymous test identity'
         else 'real sign-in'
       end as kind
from sonario.profiles p
left join sonario.memberships m on m.profile_id = p.id
left join auth.users u on u.id = p.id
order by (m.role = 'super') desc, kind, p.display_name;"""
blocks['seed1'] = read('real_schedule_2026.sql')
blocks['seed2'] = read('seed_test_data.sql')
blocks['seed3'] = read('dev_my_attendance_term3.sql')
blocks['verify'] = read('phase_b_verify.sql')

open('/tmp/sonario_rb_blocks.json','w').write(json.dumps(blocks))
open('/tmp/sonario_rb_mignote.json','w').write(json.dumps(MIG_NOTE))
print('blocks:', len(blocks), 'total chars:', sum(len(v) for v in blocks.values()))


# --- page ---
import json
S = '/tmp/sonario_rb_'
blocks = json.load(open(S + 'blocks.json'))
mignote = json.load(open(S + 'mignote.json'))

CSS = """
:root{--p:#7052CD;--lav:#EEE6FF;--ink:#111827;--meta:#6B7280;--mute:#9CA3AF;--hair:#E5E7EB;
--stop:#B91C1C;--stopbg:#FEF2F2;--warnbg:#FEF9C3;--warn:#854D0E;--ok:#15803D;--okbg:#DCFCE7;}
*{box-sizing:border-box}
body{margin:0;background:var(--lav);color:var(--ink);
font:15px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;}
.wrap{max-width:920px;margin:0 auto;padding:0 20px 120px}
header{position:sticky;top:0;z-index:20;background:var(--p);color:#fff;
box-shadow:0 2px 14px rgba(0,0,0,.14)}
.hin{max-width:920px;margin:0 auto;padding:14px 20px 12px}
h1{margin:0;font-size:20px;font-weight:800;letter-spacing:-.2px}
.sub{margin:2px 0 0;font-size:13px;color:rgba(255,255,255,.72)}
.banner{margin:12px 0 0;background:rgba(0,0,0,.22);border:1.5px solid rgba(255,255,255,.4);
border-radius:10px;padding:10px 14px;font-size:13.5px;font-weight:700;line-height:1.45}
.bar{margin-top:12px;height:7px;background:rgba(255,255,255,.22);border-radius:99px;overflow:hidden}
.bar>i{display:block;height:100%;background:#fff;width:0;transition:width .25s ease}
.barlab{margin-top:6px;font-size:12px;color:rgba(255,255,255,.8);display:flex;justify-content:space-between}
.barlab button{background:none;border:1px solid rgba(255,255,255,.45);color:#fff;border-radius:99px;
font:inherit;font-size:11px;padding:2px 10px;cursor:pointer}
.step{background:#fff;border-radius:16px;margin:18px 0;overflow:hidden;
box-shadow:0 1px 2px rgba(17,24,39,.05),0 10px 24px -18px rgba(17,24,39,.35)}
.step.done{opacity:.62}
.step.done .shead{background:var(--okbg)}
.shead{display:flex;gap:13px;align-items:flex-start;padding:16px 18px;border-bottom:1px solid #F3F4F6}
.shead input{width:21px;height:21px;margin:2px 0 0;accent-color:var(--p);cursor:pointer;flex:0 0 auto}
.snum{font-size:11px;font-weight:800;letter-spacing:1.1px;color:var(--mute)}
.stitle{margin:1px 0 0;font-size:17px;font-weight:800;letter-spacing:-.2px}
.tag{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.8px;padding:3px 8px;
border-radius:99px;margin-left:8px;vertical-align:2px}
.tag.dash{background:var(--lav);color:var(--p)}
.tag.sql{background:#E0F2FE;color:#075985}
.sbody{padding:16px 18px}
.sbody>*:first-child{margin-top:0}
.sbody p{margin:0 0 10px}
.warn{background:var(--warnbg);border-left:4px solid #CA8A04;color:var(--warn);
border-radius:0 8px 8px 0;padding:11px 14px;margin:12px 0;font-size:14px}
.warn b{color:#713F12}
.stop{background:var(--stopbg);border:2px solid var(--stop);border-radius:12px;padding:13px 15px;margin:14px 0}
.stop .h{font-size:12px;font-weight:900;letter-spacing:1.2px;color:var(--stop);margin:0 0 5px}
.stop p{margin:0;font-size:14px;color:#7F1D1D}
.exp{background:#F9FAFB;border:1px solid var(--hair);border-radius:10px;padding:11px 14px;margin:10px 0 0}
.exp .h{font-size:10px;font-weight:800;letter-spacing:1px;color:var(--mute);margin:0 0 4px}
.exp p{margin:0;font-size:14px}
.sqlwrap{margin:14px 0 0;border:1px solid var(--hair);border-radius:12px;overflow:hidden;background:#fff}
.sqlhead{display:flex;align-items:center;gap:10px;padding:9px 12px;background:#F9FAFB;
border-bottom:1px solid var(--hair)}
.sqlname{font:600 12px/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--meta);flex:1;
white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.mig{display:inline-block;font:900 13px/1 ui-monospace,Menlo,monospace;color:#fff;background:var(--p);
padding:5px 9px;border-radius:7px;letter-spacing:.5px}
button.copy{background:var(--p);color:#fff;border:none;border-radius:99px;padding:6px 15px;
font:700 12.5px/1 inherit;cursor:pointer;white-space:nowrap}
button.copy:hover{background:#5b3fac}
button.copy.ok{background:var(--ok)}
button.peek,button.sel{background:none;border:1px solid var(--hair);color:var(--meta);
border-radius:99px;padding:6px 12px;font:600 12px/1 inherit;cursor:pointer;white-space:nowrap}
button.sel{border-color:var(--p);color:var(--p)}
button.sel.ok,button.peek.ok{background:var(--okbg);border-color:var(--ok);color:var(--ok)}
pre::selection,pre *::selection{background:#C7B6F5}
pre{margin:0;padding:13px;max-height:300px;overflow:auto;background:#FCFCFD;
font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;display:none}
pre.show{display:block}
code{background:var(--lav);color:#4c3a8f;padding:1px 5px;border-radius:4px;
font:12.5px ui-monospace,Menlo,monospace}
ol,ul{margin:0 0 10px;padding-left:22px}li{margin:4px 0}
.order{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 14px}
.order span{font:800 12px/1 ui-monospace,Menlo,monospace;background:var(--lav);color:var(--p);
padding:7px 9px;border-radius:7px}
.order span.last{background:var(--p);color:#fff}
.order span.prev{background:var(--okbg);color:var(--ok)}
.foot{text-align:center;color:var(--meta);font-size:13px;margin:26px 0 0}
h3{font-size:14px;margin:16px 0 6px;letter-spacing:-.1px}
"""

JS = """
const K='sonario-phase-b-v1';
const state=JSON.parse(localStorage.getItem(K)||'{}');
function save(){try{localStorage.setItem(K,JSON.stringify(state))}catch(e){}}
function paint(){
  const boxes=[...document.querySelectorAll('.shead input')];
  boxes.forEach(b=>{const on=!!state[b.dataset.id];b.checked=on;b.closest('.step').classList.toggle('done',on);});
  const n=boxes.filter(b=>b.checked).length;
  document.querySelector('.bar>i').style.width=(n/boxes.length*100)+'%';
  document.getElementById('cnt').textContent=n+' of '+boxes.length+' done';
}
document.addEventListener('change',e=>{
  if(!e.target.matches('.shead input'))return;
  state[e.target.dataset.id]=e.target.checked; save(); paint();
});
document.getElementById('reset').addEventListener('click',()=>{
  if(!confirm('Clear all progress on this page?'))return;
  for(const k in state)delete state[k]; save(); paint();
});
// Copying has to work from file:// (not a secure context, so navigator.clipboard is absent) AND
// from http://localhost (secure, but the API still rejects if the document isn't focused). So:
// try the modern API, and fall back to execCommand on ANY failure rather than only on a missing
// API. Testing this found the bug — the first version only fell back when the context was
// insecure, so a rejected promise on localhost left the button saying "select it manually".
function legacyCopy(t){
  return new Promise((res,rej)=>{
    const ta=document.createElement('textarea');
    ta.value=t; ta.setAttribute('readonly','');
    ta.style.cssText='position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select(); ta.setSelectionRange(0,ta.value.length);
    let ok=false;
    try{ok=document.execCommand('copy')}catch(e){ok=false}
    document.body.removeChild(ta);
    ok?res():rej(new Error('execCommand copy refused'));
  });
}
function copyText(t){
  if(navigator.clipboard&&window.isSecureContext){
    return navigator.clipboard.writeText(t).catch(()=>legacyCopy(t));
  }
  return legacyCopy(t);
}
// Selecting the block is the path that ALWAYS works: no permissions, no secure context, no user
// activation needed. So it is both the fallback for Copy and a button of its own — because the
// clipboard API can refuse for reasons the page can't see or fix, and the runbook must not be
// dependent on it. Select, then Cmd-C.
function selectBlock(id){
  const pre=document.getElementById(id);
  pre.classList.add('show');
  const r=document.createRange(); r.selectNodeContents(pre);
  const sel=window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
  pre.scrollIntoView({block:'nearest'});
  return sel.toString().length;
}
function flash(b,msg,cls){
  const o=b.dataset.label||b.textContent;
  b.dataset.label=o; b.textContent=msg; if(cls)b.classList.add(cls);
  setTimeout(()=>{b.textContent=o;if(cls)b.classList.remove(cls)},2200);
}
document.addEventListener('click',e=>{
  const s=e.target.closest('button.sel');
  if(s){ selectBlock(s.dataset.for); flash(s,'Selected — press ⌘C','ok'); return; }
  const b=e.target.closest('button.copy');
  if(b){
    const t=document.getElementById(b.dataset.for).textContent;
    copyText(t).then(()=>flash(b,'Copied','ok'))
      .catch(()=>{ selectBlock(b.dataset.for); flash(b,'Selected — press ⌘C','ok'); });
    return;
  }
  const p=e.target.closest('button.peek');
  if(p){
    const pre=document.getElementById(p.dataset.for);
    pre.classList.toggle('show');
    p.textContent=pre.classList.contains('show')?'Hide':'View';
  }
});
paint();
"""

def esc(t):
    return t.replace('&','&amp;').replace('<','&lt;').replace('>','&gt;')

_n = [0]
def sqlblock(key, label, mig=None):
    _n[0] += 1
    pid = f'sql{_n[0]}'
    tag = f'<span class="mig">{mig}</span>' if mig else ''
    return f"""<div class="sqlwrap">
<div class="sqlhead">{tag}<span class="sqlname">{label}</span>
<button class="peek" data-for="{pid}">View</button>
<button class="sel" data-for="{pid}">Select</button>
<button class="copy" data-for="{pid}">Copy</button></div>
<pre id="{pid}">{esc(blocks[key])}</pre></div>"""

_s = [0]
def step(title, kind, body):
    _s[0] += 1
    i = _s[0]
    t = 'dash' if kind == 'dash' else 'sql'
    lab = 'DASHBOARD' if kind == 'dash' else ('SQL' if kind == 'sql' else 'BOTH')
    if kind == 'both': t = 'sql'
    return f"""<section class="step"><div class="shead">
<input type="checkbox" data-id="s{i}" aria-label="Mark step {i} done" />
<div><div class="snum">STEP {i}</div>
<div class="stitle">{title}<span class="tag {t}">{lab}</span></div></div></div>
<div class="sbody">{body}</div></section>"""

STOP = lambda p: f'<div class="stop"><p class="h">⛔ STOP IF THIS FAILS</p><p>{p}</p></div>'
EXP  = lambda p: f'<div class="exp"><p class="h">EXPECTED RESULT</p><p>{p}</p></div>'
WARN = lambda p: f'<div class="warn">{p}</div>'

steps = []

steps.append(step('Create the new Supabase project', 'dash', """
<p>Supabase dashboard → <b>New project</b>.</p>
<ul>
<li><b>Name:</b> <code>sonario</code></li>
<li><b>Region:</b> check the OLD project's region first and <b>match it</b>, so latency doesn't shift under the app.</li>
<li>Save the database password somewhere safe — it's unrecoverable, though no step here needs it.</li>
</ul>
<p>Note the <b>project ref</b> (the <code>xxxxxxxx</code> in <code>https://xxxxxxxx.supabase.co</code>). Needed at cutover, not now.</p>
""" + EXP('A new project, provisioning for a minute or two. Nothing else changes.')))

steps.append(step('Run migration <code>0000</code> — it creates the schema', 'sql', """
<p>SQL Editor → new query → paste → Run.</p>
""" + WARN("""<b>This has to come before exposing the schema.</b> An earlier version of this runbook had
those two the other way round, which is impossible: <code>sonario</code> can't appear in the Exposed
schemas dropdown until it exists, and only <code>0000</code> creates it. If that dropdown shows just
<code>public</code> and <code>graphql_public</code>, this step hasn't run yet.""")
+ sqlblock('mig0000', '0000_schema_and_grants.sql', mig='0000')
+ EXP('<code>Success. No rows returned.</code>')
+ STOP('If this errors, stop. Everything downstream assumes the schema and its grants exist.')))

steps.append(step('Expose the <code>sonario</code> schema', 'dash', """
<p>Settings → API → Data API → <b>Exposed schemas</b> → tick <code>sonario</code>, keep
<code>public</code> and <code>graphql_public</code> as they are.</p>
""" + WARN("""<b>Do not skip this.</b> The app is pinned to <code>db.schema = 'sonario'</code>. Without
it, every single request 404s and the app looks completely broken while the database is perfectly correct.
No SQL can set it, and nothing later in this runbook will catch it.""")
+ '''<p>Two other settings on that page, for reference — <b>leave both alone</b>:</p>
<ul>
<li><b>Automatically expose new tables</b> — on by default. Supabase suggests disabling it for manual
control, but Sonario's migrations grant privileges <i>explicitly</i> (<code>0000</code> sets default
privileges, <code>0007</code> sweeps), so it makes no difference either way. Not worth changing mid-build.</li>
<li><b>Extra search path</b> (<code>public, extensions</code>) — correct as-is. Every Sonario function sets
<code>search_path = ''</code> and fully qualifies its names, so it doesn't rely on this.</li>
</ul>'''
+ EXP('<code>sonario</code> ticked, and the count reads <b>3 of 3 schemas exposed</b>.')))

order = '<div class="order">' + ''.join(
    f'<span class="{"last" if k=="0007" else ("prev" if k=="0000" else "")}">{k}'
    f'{" ✓" if k=="0000" else ""}</span>' for k in
    ['0000','0001','0002','0003','0004','0005','0006','0007']) + '</div>'

mig_html = [f"""<p>SQL Editor → new query → paste → Run. <b>One at a time, in this order.</b>
<code>0000</code> already ran in step 2.</p>
{order}
<p><code>0007</code> is always last: it's the grant sweep, the explicit revokes, and a verification
readout.</p>""" + STOP("""If any migration errors, <b>stop there</b>. Do not run the next one, and do not
re-run the failed one hoping it settles. Paste the error to Claude — the order matters and a partial
chain is diagnosable, whereas a chain you kept pushing through is not.""")]

for m in ['0001_foundation.sql','0002_events_and_privacy.sql',
          '0003_checkin_undo_window.sql','0004_signup_trigger_skips_anonymous.sql',
          '0005_members_can_actually_cancel_leave.sql','0006_voice_parts.sql',
          '0007_grant_sweep_and_revokes.sql']:
    k = m[:4]
    title, note = mignote[k]
    mig_html.append(f'<h3>{k} — {title}</h3><p style="color:var(--meta);font-size:14px">{note}</p>')
    mig_html.append(sqlblock('mig' + k, m, mig=k))
    if k == '0007':
        mig_html.append(EXP('<b>8 rows</b>, one per function. Every <code>verdict</code> column must read <code>ok</code>.'))
        mig_html.append(STOP("""<b>Any <code>verdict</code> that is not <code>ok</code> stops Phase B here.</b>
It means the revokes didn't apply, and the four trigger functions are still reachable from the API.
Don't seed on top of it — paste the 8 rows to Claude first."""))
    else:
        mig_html.append(EXP('<code>Success. No rows returned.</code>'))

steps.append(step('Run <code>0001</code> through <code>0007</code>', 'sql', ''.join(mig_html)))

steps.append(step('Google sign-in', 'dash', """
<p><b>4a — Supabase:</b> Authentication → Providers → <b>Google</b> → enable, and paste the same
client ID and secret the old project uses (Google Cloud Console → Clients).</p>
<p><b>4b — Google Cloud Console:</b> the same OAuth client → Authorised redirect URIs → <b>add</b>:</p>
<pre class="show" style="max-height:none">https://&lt;NEW-PROJECT-REF&gt;.supabase.co/auth/v1/callback</pre>
""" + WARN("""<b>Add it, don't replace the old one.</b> The deployed app still points at the old project
until cutover. Removing the old URI breaks sign-in for the live app immediately.""")
+ '<p>The consent screen app name ("Sonario") is per Google-Cloud-project, so it carries over untouched.</p>'
+ EXP('Google enabled in the new project, and two callback URIs listed in Google Cloud Console.')))

steps.append(step('Email sign-in and redirect URLs', 'dash', """
<ul>
<li>Authentication → Providers → <b>Email</b>: enabled. <code>signInWithOtp</code> is a live path in
<code>js/auth.js</code>, not dead code.</li>
<li>Authentication → URL Configuration → <b>Site URL</b> = your Vercel production URL.</li>
<li><b>Redirect URLs</b> must include the Vercel URL <b>and</b> <code>http://localhost:8777</code>.</li>
</ul>
""" + WARN("""The app passes <code>redirectTo: window.location.origin</code>. Without the localhost entry,
the local sign-in you need in the very next step will fail.""")
+ EXP('Email provider on; both URLs in the redirect allow-list.')))

steps.append(step('Sign in once, then promote yourself', 'both', """
<p>Your <code>auth.users</code> row only exists once you've signed in. So, temporarily:</p>
<ol>
<li>Edit <code>js/config.js</code> — swap <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code>
for the new project's (Settings → API).</li>
<li>Serve the folder locally and open it: <code>python3 -m http.server 8777</code></li>
<li>Sign in with Google.</li>
<li><b>Revert <code>js/config.js</code> immediately.</b></li>
</ol>
""" + WARN("""<b>Never commit that edit.</b> Committing it would cut the deployed app over by accident,
silently, mid-Phase-B. <code>git checkout js/config.js</code> reverts it. Cutover is a separate, explicitly
approved step.""") + """
<p>Then promote the membership the signup trigger created:</p>
""" + sqlblock('promote', 'recreate_test_identities.sql — step 1')
+ EXP('<b>Exactly one row</b>, showing <code>active</code> / <code>super</code>.')
+ STOP("""<b>Zero rows means stop.</b> Either you haven't signed in against the NEW project yet, or the
email doesn't match. Don't retry it blindly and don't hand-write a UUID — the query looks the id up on
purpose.""")))

steps.append(step('Create the Leave Test identity', 'both', """
<p>A dedicated <b>ordinary member</b> for testing RLS, leave and normal-member behaviour. It doesn't
need the old UUID.</p>
<p>In a private window on the locally-served app, open the browser console:</p>
""" + sqlblock('anon_console', 'browser console — not SQL') + """
<p>Then paste that uuid into <b>both</b> places below:</p>
""" + sqlblock('leavetest', 'recreate_test_identities.sql — step 3')
+ WARN("""This is manual because migration <code>0004</code> makes the signup trigger <b>skip anonymous
identities</b> — the fix for Page Turners visitors filling Sonario's approval queue. So no profile or
membership is created automatically.""")
+ EXP("Two inserts succeed. The role must be <code>member</code>, never <code>super</code> — if it were a super, every &ldquo;verified as a plain member&rdquo; RLS result obtained with it would be worthless.")))

steps.append(step('Seed the data — in this order', 'sql', """
<p>Schedule <b>first</b> (the attendance script needs the events to exist), attendance <b>last</b>
(it looks you up by email, so it self-heals to your new uuid with nothing edited).</p>
""" + sqlblock('seed1', '1. real_schedule_2026.sql — terms + all 21 events')
+ EXP('2 terms; 21 events; Melbourne Cup Day (3 Nov) cancelled.')
+ sqlblock('seed2', '2. seed_test_data.sql — the 8 fake members')
+ EXP('8 rows. One is a <b>super</b> (Marguerite Okafor) — that is deliberate, so the organiser screens have something to render.')
+ sqlblock('seed3', '3. dev_my_attendance_term3.sql — your Term 3 attendance')
+ EXP('7 check-ins and 2 absences across Term 3. Home should later read <b>7 / 9</b> and <b>78%</b>.')
+ sqlblock('whoexists', 'optional — confirm who exists')
+ EXP('10 rows. 2 supers (you + Marguerite). Leave Test as active/member. Callum pending, Rowan deactivated.')))

steps.append(step('Verify, and send the output to Claude', 'sql', """
<p>One query. About 20 rows, sorted so anything wrong appears <b>at the top</b>. It answers all five
Phase&nbsp;B report questions at once: did the migrations run cleanly, do schema/policies/functions/grants
match, does the seed reconcile, any auth differences, anything blocking cutover.</p>
""" + sqlblock('verify', 'phase_b_verify.sql')
+ EXP("""First row must read <code>NEW SONARIO PROJECT — correct</code>. Then: 18 tables · 8 functions ·
40 policies · 5 triggers · 12 realtime · 12 indexes · 0 with RLS off · legacy tables absent · grants
present · 2 terms · 21 events · 10 profiles · 8 active · <b>2 super</b> · 7 check-ins · 11 part_labels ·
Leave Test active/member · 1 trigger on <code>auth.users</code> · Google identity present.""")
+ STOP("""<b>Any row whose <code>verdict</code> is not <code>ok</code>.</b> <code>BLOCKER</code> rows sort
to the top for exactly this reason. Don't proceed to cutover — paste the whole output to Claude.""")
+ WARN("""<b><code>2 super</code> is correct, not a defect.</b> <code>seed_test_data.sql</code> deliberately
makes one seeded fake a super. A check expecting 1 would be the thing that's wrong.""")))

NOT_IN = """<section class="step"><div class="sbody">
<h3 style="margin-top:0">Explicitly NOT part of Phase B</h3>
<ul>
<li>Editing <code>js/config.js</code> for real, or committing it</li>
<li>Cutting the deployed app over</li>
<li>Touching the old shared project in any way — no trigger removal, no function removal, no schema drop,
no legacy tables, no storage objects</li>
<li>Creating a Storage bucket (that belongs with Repertoire/Recordings, after cutover)</li>
<li>Recreating <code>notices</code>, <code>social_events</code>, <code>social_rsvps</code> — confirmed
empty, agreed as legacy</li>
</ul></section>"""

html = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Sonario · Phase B runbook</title>
<style>{CSS}</style></head><body>
<header><div class="hin">
<h1>Sonario — Phase B runbook</h1>
<p class="sub">Build the new dedicated Supabase project. Ten steps. Progress saves in this browser.<br />Every SQL block has <b>Copy</b>, and <b>Select</b> if your browser blocks clipboard access — then ⌘C.</p>
<div class="banner">⚠️ The old shared Supabase project must remain untouched during Phase B.
No cutover, no decommissioning.</div>
<div class="bar"><i></i></div>
<div class="barlab"><span id="cnt">0 of 10 done</span><button id="reset">Reset progress</button></div>
</div></header>
<div class="wrap">
{''.join(steps)}
{NOT_IN}
<p class="foot">Generated from the repo's own migration files, so every Copy button gives the exact
committed SQL.<br />Sonario · Phase B · see <code>supabase/SPLIT-PLAN.md</code> for the full plan.</p>
</div>
<script>{JS}</script></body></html>"""

out = '/Users/nina.kowalski/Downloads/sonario-phase-b-runbook.html'
open(out, 'w').write(html)
print('written', out, len(html), 'bytes')
