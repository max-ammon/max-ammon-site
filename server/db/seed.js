'use strict';

/*
 * Seeds the database with the site's CURRENT content, colours and settings, so
 * the first DB-driven render is identical to the original static site.
 * Text is copied verbatim from index.html / gallery.html (including the
 * original spellings) — do not "correct" it here; that is the owner's content.
 * Runs only when the database is empty (first boot).
 */

const COLORS = [
  // token,          value,        category,   label
  ['basecolor',      '#5a5a5a',    'section',  'Background'],
  ['headercolor',    '#424242',    'section',  'Header & bars'],
  ['headercolor1',   '#42424273',  'section',  'Header (translucent)'],
  ['titlecolor',     '#000000',    'text',     'Titles & accents'],
  ['secondarycolor', '#262626',    'text',     'Body text'],
  ['lightcolor',     '#8b8b8b',    'text',     'Light text & links'],
];

const SETTINGS = {
  site_title:        'Max Ammon',
  job_title:         '3D Artist',
  // Social-share / Open Graph defaults (the preview card shown when a link is
  // shared), editable at /admin/social. Empty title falls back to each page's
  // own <title>; empty image falls back to the About banner.
  share_title:         '',
  share_description:   'Portfolio of Max Ammon, 3D artist based in Cologne, Germany.',
  share_image:         '',
  social_preview_bots: '1',
  demo_youtube_id:   'CL1Xj0JybFY',
  demo_aspect_w:     '3840',
  demo_aspect_h:     '1646',
  demo_poster:       '/assets/images/demo_thumbnail.png',
  contact_recipient: '3d@max-ammon.com',
  about_banner:      '/assets/images/Website_AboutMe_Banner.png',
  about_profile:     '/assets/images/Website_AboutMe_Profilepicture.png',
  skills_modeling_img1:  '/assets/images/skills_modeling_projector.png',
  skills_modeling_img2:  '/assets/images/skills_modeling_sim.png',
  skills_texturing_img:  '/assets/images/skills_texturing1.png',
  skills_animation_img:  '/assets/images/skills_animation.png',
  skills_grading_img:    '/assets/images/skills_grading1.png',
};

// block_key, grp, label, value, format
const CONTENT = [
  ['demo.title',    'demo',    'Demo heading',        'Demo',     'text'],
  ['demo.year',     'demo',    'Demo year',           '2024-25',  'text'],

  ['skills.heading', 'skills', 'Section heading',     'My Skills', 'text'],

  ['skills.modeling.title', 'skills', 'Modeling — title',
    'Modeling & Simulations', 'text'],
  ['skills.modeling.body', 'skills', 'Modeling — description',
    'Generation of static and dynamic surfaces through manual-modeling, procedural generation, and physical-simulations.',
    'multiline'],

  ['skills.texturing.title', 'skills', 'Texturing — title',
    'Texturing & Lighting', 'text'],
  ['skills.texturing.body', 'skills', 'Texturing — description',
    'Layering physical attributes on the surfaces that represent specific materials. This can be achieved with real texture maps, manually painted masks and values, and procedural generation.\n\nSetting up a combination of lights to make the shapes and materials in the scene visible, pronounce the details, and create the intended look.',
    'multiline'],

  ['skills.animation.title', 'skills', 'Animation — title',
    'Animation', 'text'],
  ['skills.animation.body', 'skills', 'Animation — description',
    'Setting objects, lights and cameras in motion, to follow the script and visually tell the desired story.',
    'multiline'],

  ['skills.grading.title', 'skills', 'Compositing — title',
    'Compositing & Grading', 'text'],
  ['skills.grading.body', 'skills', 'Compositing — description',
    'Merging of the image-output from the 3D-renders and postprocessing.\n\nTweaking of the colors and distribution of the brighness values, to create a visually well-balanced, and hight-quallity product.',
    'multiline'],

  ['skills.pipeline.title', 'skills', 'Pipeline bar — label along the line', 'production pipeline', 'text'],
  ['skills.pipeline.start', 'skills', 'Pipeline bar — top label', 'concept', 'text'],
  ['skills.pipeline.end', 'skills', 'Pipeline bar — bottom label', 'finished product', 'text'],
  ['skills.software.note', 'skills', 'Software list note (shown above the software list on phones/tablets)',
    'Software I work with across the production pipeline', 'text'],

  ['about.heading', 'about', 'Section heading', 'About Me', 'text'],
  ['about.body', 'about', 'About text',
    'Hi I’m Max, a 24 year old 3D-Artist located in Cologne, Germany.\n\nSince my childhood i was fascinated by cg-films. From the age of 14 to 17 I began to acquaint myself with 3D grafics through casual 3D projects. Following that I took the chance to take a 1 1/2 year professional 3D-Animation & VFX class.\n\nStarting out I focused on manual hardsurface-modeling, texturing and lighting, and since then have expanded my skillset to include procedrual generation and physical simulations. In addition to that I have grown my knowlege about compositing and color-grading, to be able to produce an Idea from beginning, to the desired visual end-product.\n\nIf you think I could be the one to realize your project, feel free to contact me!',
    'multiline'],

  ['contact.heading',  'contact', 'Section heading', 'Contact', 'text'],
  ['contact.email',    'contact', 'Email',    '3d@max-ammon.com', 'text'],
  ['contact.internet', 'contact', 'Internet', 'max-ammon.com', 'text'],
  ['contact.youtube',  'contact', 'YouTube',  'https://www.youtube.com/@MaxAmmon-3d', 'text'],
  ['contact.linkedin', 'contact', 'LinkedIn', 'https://www.linkedin.com/in/max-ammon-a39081357/', 'text'],
  ['contact.xing',     'contact', 'Xing',     'https://www.xing.com/profile/Max_Ammon077987', 'text'],

  ['gallery.heading', 'gallery', 'Section heading', 'Gallery', 'text'],
  ['gallery.intro', 'gallery', 'Gallery intro',
    'In this gallery you will find some concepts, unfinished and finished personal projects and assets, both older and current.<br>To view the content in full resolution, you can just click on it!',
    'html'],
  ['gallery.colorinfo', 'gallery', 'Colour-management note',
    'Depending on your browser, operating-system and hardware, the web-player may display the P3-D65 colorspace and 10bit color-depth incorrectly.<br><br>By clicking on the marked versions:<br>you can download the content\n                    <b><u>uncompressed</u></b> in <b><u>rec2020</u></b> colors with <b><u>10bit</u></b> depth(.mxf/DNxHQX), you will also find one <b><u>sRGB</u></b> and one <b><u>P3-D65</u></b> version(.mp4/h.265).<br>By using a local color-managed\n                    player, you will get the most accurate representation of the colors.',
    'html'],

  // Imprint / Impressum (German sites need one — § 5 DDG). Editable in the Text
  // admin under "Imprint"; shown on /impressum. Fill address/phone in; the rest are
  // optional. Only non-empty fields are shown on the page.
  ['imprint.name', 'imprint', 'Name', 'Max Ammon', 'text'],
  ['imprint.address', 'imprint', 'Address (street, postcode, city, country)', '', 'multiline'],
  ['imprint.email', 'imprint', 'Email', '3d@max-ammon.com', 'text'],
  ['imprint.phone', 'imprint', 'Phone', '', 'text'],
  ['imprint.vat', 'imprint', 'VAT ID / USt-IdNr. (leave blank if none)', '', 'text'],
  ['imprint.responsible', 'imprint', 'Responsible for content, § 18 Abs. 2 MStV (usually same as above)', '', 'text'],
  ['imprint.additional', 'imprint', 'Additional information (optional)', '', 'multiline'],
  ['imprint.privacy', 'imprint', 'Privacy / bot-protection note (HTML; shown on /impressum while the CAPTCHA gate is on)',
    'Diese Website verwendet Cloudflare Turnstile, einen Dienst der Cloudflare, Inc. (101 Townsend St, San Francisco, CA 94107, USA), zum Schutz vor automatisierten Zugriffen (Bots). Beim Aufruf der Seite prüft Turnstile, ob es sich um einen menschlichen Besucher handelt; dabei können technische Daten wie die IP-Adresse an Cloudflare übertragen und dort verarbeitet werden. Weitere Informationen finden Sie in der <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Datenschutzerklärung von Cloudflare</a>.',
    'html'],
  ['imprint.privacy_en', 'imprint', 'Privacy note — English (HTML; shown next to the German one while the gate is on)',
    'This website uses Cloudflare Turnstile, a service provided by Cloudflare, Inc. (101 Townsend St, San Francisco, CA 94107, USA), to protect against automated access (bots). When you access the site, Turnstile checks whether you are a human visitor; technical data such as your IP address may be transmitted to and processed by Cloudflare. For more information, see the <a href="https://www.cloudflare.com/privacypolicy/" target="_blank" rel="noopener noreferrer">Cloudflare Privacy Policy</a>.',
    'html'],
  ['imprint.analytics', 'imprint', 'Privacy — analytics note, German (HTML; always shown on /impressum)',
    '<strong>Webanalyse:</strong> Diese Website nutzt eine selbst gehostete, datensparsame Reichweitenmessung, um zu erkennen, welche Inhalte aufgerufen werden. Dabei werden keine Cookies gesetzt und keine IP-Adressen gespeichert. Zur Schätzung der Besucherzahl wird pro Tag ein nicht umkehrbarer, anonymer Zählwert aus IP-Adresse und Browserkennung gebildet; der dafür verwendete Zufallswert wechselt täglich und wird niemals gespeichert, sodass kein Personenbezug entsteht und keine Wiedererkennung über mehrere Tage möglich ist. Erfasst werden ausschließlich die aufgerufene Seite, der Gerätetyp (Mobil/Tablet/Desktop) und die Domain der verweisenden Seite, jeweils in aggregierter Form. Die Daten verbleiben ausschließlich auf dem Server dieser Website und werden nicht an Dritte weitergegeben. Anfragen mit aktivierter "Do Not Track"- oder GPC-Einstellung werden nicht gezählt.',
    'html'],
  ['imprint.analytics_en', 'imprint', 'Privacy — analytics note, English (HTML; always shown on /impressum)',
    '<strong>Web analytics:</strong> This website uses a self-hosted, privacy-friendly visitor measurement to understand which content is viewed. It sets no cookies and stores no IP addresses. To estimate visitor numbers, a non-reversible, anonymous value is derived each day from the IP address and browser signature; the random value used for this rotates daily and is never stored, so no personal reference is created and no recognition across several days is possible. Only the page viewed, the device type (mobile/tablet/desktop) and the domain of the referring site are recorded, in aggregated form. The data remains solely on the server of this website and is not shared with third parties. Requests sent with "Do Not Track" or GPC enabled are not counted.',
    'html'],
];

function seedIfEmpty(db) {
  const already = db.prepare('SELECT COUNT(*) AS c FROM color_tokens').get().c;
  if (already > 0) return;

  const insColor = db.prepare(
    'INSERT INTO color_tokens (token, value, default_value, category, label, sort) VALUES (?,?,?,?,?,?)'
  );
  const insSetting = db.prepare(
    'INSERT INTO site_settings (key, value) VALUES (?, ?) ' +
    'ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const insContent = db.prepare(
    'INSERT INTO content_blocks (block_key, grp, label, value, format, sort) VALUES (?,?,?,?,?,?)'
  );

  const run = db.transaction(() => {
    COLORS.forEach((c, i) => insColor.run(c[0], c[1], c[1], c[2], c[3], i + 1));
    Object.entries(SETTINGS).forEach(([k, v]) => insSetting.run(k, v));
    CONTENT.forEach((row, i) => insContent.run(row[0], row[1], row[2], row[3], row[4], i + 1));
  });
  run();
  // eslint-disable-next-line no-console
  console.log('[seed] database seeded with current content, colours and settings.');
}

// --- gallery projects ------------------------------------------------------
// Paths validated against the files on disk; download links use the real
// (occasionally mis-spelled) filenames so they actually resolve.
const G = '/assets/images/gallery/';
const D = '/assets/images/gallery/download/';
const REC = 'rec2020 10bit .mxf/DNxHQX';
const P3 = 'P3-D65 10bit .mp4/h.265';
const SRGB = 'sRGB 8bit .mp4/h.265';

const GALLERY = [
  {
    title: 'Intro For Demo 2024-25', year: '2024', layout: 'project-layout0',
    description: 'I created these shots specificly to act as an intro to my current demo-video.',
    media: [{ type: 'video', full: G + 'demointro.mp4', preview: G + 'demointro_preview.mp4', aspect: 'cinemascope' }],
  },
  {
    title: 'Planet Earth', year: '2024', layout: 'project-layout0',
    description: 'Taking a look at a very famliar planet, while in transit.',
    media: [{ type: 'video', full: D + 'planetearth_p3d65.mp4', preview: G + 'planetearth_preview_p3d65.mp4', aspect: 'cinemascope' }],
    downloads: [
      { label: REC, file: D + 'planetearth_rec2020.mxf', kind: 'rec2020', bytes: 407349832 },
      { label: P3, file: D + 'planetearth_p3d65.mp4', kind: 'p3d65', bytes: 27997618 },
      { label: SRGB, file: D + 'planetearth_srgb.mp4', kind: 'srgb', bytes: 27998214 },
    ],
  },
  {
    title: 'Fruty Drink', year: '2024', layout: 'project-layout0',
    description: 'Based on a prior conzept you can find here, this is a simulation that could have been part of a commercial for some type of fruity drink.',
    media: [{ type: 'video', full: D + 'fruitdrink_p3d65.mp4', preview: G + 'fruitdrink_preview_p3d65.mp4', aspect: 'cinemascope' }],
    downloads: [
      { label: REC, file: D + 'fruitdrink_rec2020.mxf', kind: 'rec2020', bytes: 112993852 },
      { label: P3, file: D + 'fruitdrink_p3d65.mp4', kind: 'p3d65', bytes: 8599954 },
      { label: SRGB, file: D + 'fruitdrinkt_srgb.mp4', kind: 'srgb', bytes: 8597793 },
    ],
  },
  {
    title: 'Floating Cubes', year: '2024', layout: 'project-layout0',
    description: 'A little abstract motion graphics project.',
    media: [{ type: 'video', full: D + 'hoveringcubes_p3d65.mp4', preview: G + 'hoveringcubes_preview_p3d65.mp4', aspect: 'cinemascope' }],
    downloads: [
      { label: REC, file: D + 'hoveringcubes_reg2020.mxf', kind: 'rec2020', bytes: 657861192 },
      { label: P3, file: D + 'hoveringcubes_p3d65.mp4', kind: 'p3d65', bytes: 12785170 },
      { label: SRGB, file: D + 'hoveringcubes_srgb.mp4', kind: 'srgb', bytes: 12785743 },
    ],
  },
  {
    title: 'Ember', year: '2024', layout: 'project-layout0',
    description: 'Something consisting or containing paper probably did catch fire.',
    media: [{ type: 'video', full: D + 'ember_p3d65.mp4', preview: G + 'ember1_preview.mp4', aspect: 'cinemascope' }],
    downloads: [
      { label: REC, file: D + 'ember_rec2020.mxf', kind: 'rec2020', bytes: 250775100 },
      { label: P3, file: D + 'ember_p3d65.mp4', kind: 'p3d65', bytes: 16622142 },
      { label: SRGB, file: D + 'ember_srgb.mp4', kind: 'srgb', bytes: 16612749 },
    ],
  },
  {
    title: '"Rasberry"', year: '2023', layout: 'project-layout0',
    description: 'This is a concept, in which i tried to match the style of a commercial for some type of fruity drink.',
    media: [{ type: 'video', full: G + 'rasberry.mp4', preview: G + 'rasberry_preview.mp4', aspect: 'cinemascope' }],
  },
  {
    title: 'Foresting', year: '2023', layout: 'project-layout0',
    description: 'An asset depicting a tree-stump, with an axe driven into it. Some type of forrest-work is apperantly going on...',
    media: [{ type: 'video', full: D + 'forresting_p3d65.mp4', preview: G + 'forresting_preview_p3d65.mp4', aspect: 'cinemascope' }],
    downloads: [
      { label: REC, file: D + 'forresting_rec2020.mxf', kind: 'rec2020', bytes: 149004860 },
      { label: P3, file: D + 'forresting_p3d65.mp4', kind: 'p3d65', bytes: 11301246 },
      { label: SRGB, file: D + 'forresting_srgb.mp4', kind: 'srgb', bytes: 11301087 },
    ],
  },
  {
    title: 'The Growing Floor', year: '2021', layout: 'project-layout0',
    description: "This is a motion-graphics concept, which I didn't pursue further.\nWhat your seing is not a rendered image, instead just a capture of the viewport of the 3D-software.",
    media: [{ type: 'video', full: G + 'the_growing_floor.mp4', preview: G + 'the_growing_floor_preview.mp4', aspect: 'sixtybynine' }],
  },
  {
    title: 'Material Simunlation', year: '2022', layout: 'project-layout0',
    description: 'This was just a fun little project, where i played with different solvers.',
    media: [{ type: 'video', full: G + 'collision_sim.mp4', preview: G + 'collision_sim_preview.mp4', aspect: 'sixtybynine' }],
  },
  {
    title: 'Tatra 815-7 8x8 Offroad Truck', year: '2019', layout: 'project-layout1',
    description: 'Here you can see an asset, based on a czech build all terrain truck bei the company "Tatra".',
    media: [
      { type: 'video', full: G + 'tatra1.mp4', preview: G + 'tatra1_preview.mp4', aspect: 'cinemascope' },
      { type: 'image', full: G + 'tatra0.png', preview: G + 'tatra0_preview.png', aspect: 'cinemascope' },
      { type: 'image', full: G + 'tatra2.png', preview: G + 'tatra2.png', aspect: 'cinemascope' },
    ],
  },
  {
    title: 'mbQuart HiFi Speaker', year: '2019', layout: 'project-layout0',
    description: 'This asset depicts one hifi speaker, that i once had a pair of. My goal was to kind of "immortalize" it.',
    media: [{ type: 'image', full: G + 'mbquart_speaker1.png', preview: G + 'mbquart_speaker1.png', aspect: 'square' }],
  },
  {
    title: 'Dual Record Player', year: '2019', layout: 'project-layout0',
    description: 'This asset depicts a recordplayer, that i used in the past. I wanted to kind of "immortalize" it.',
    media: [{ type: 'image', full: G + 'dual_recordplayer.png', preview: G + 'dual_recordplayer.png', aspect: 'custom-aspect' }],
  },
  {
    title: 'Witchers Amulet', year: '2017', layout: 'project-layout0',
    description: 'A "fan-art" referencing the video-game "The Wichter 3: Wild Hunt"',
    media: [{ type: 'video', full: G + 'wichters_amulet.mp4', preview: G + 'wichters_amulet_preview.mp4', aspect: 'sixtybynine' }],
  },
  {
    title: 'Gaming Computer', year: '2018', layout: 'project-layout0',
    description: 'High-end gaming machine for serious players.',
    media: [
      { type: 'image', full: G + 'gaming_computer.png', preview: G + 'gaming_computer_preview.png', aspect: 'square' },
      { type: 'image', full: G + 'gaming_computer_ao.png', preview: G + 'gaming_computer_ao.png', aspect: 'square' },
    ],
  },
  {
    title: 'Really Old Models', year: '2015-16', layout: 'project-layout1',
    description: 'Some really old models, from when I just started messing arround with 3D-software for fun..',
    media: [
      { type: 'image', full: G + 'can.png', preview: G + 'can_preview.png', aspect: 'square' },
      { type: 'image', full: G + 'knife.png', preview: G + 'knife_preview.png', aspect: 'square' },
      { type: 'image', full: G + 'coffeemaker.png', preview: G + 'coffeemaker_preview.png', aspect: 'sixtybynine' },
    ],
  },
];

function seedProjectsIfEmpty(db) {
  const already = db.prepare('SELECT COUNT(*) AS c FROM gallery_projects').get().c;
  if (already > 0) return;

  const insP = db.prepare(
    'INSERT INTO gallery_projects (title, year, description, layout, sort, published) VALUES (?,?,?,?,?,1)'
  );
  const insM = db.prepare(
    'INSERT INTO media_items (project_id, type, full_path, preview_path, aspect_class, alt_text, sort) VALUES (?,?,?,?,?,?,?)'
  );
  const insD = db.prepare(
    'INSERT INTO media_downloads (project_id, label, file_path, kind, filesize_bytes, sort) VALUES (?,?,?,?,?,?)'
  );
  const setThumb = db.prepare('UPDATE gallery_projects SET thumbnail_media_id = ? WHERE id = ?');

  const run = db.transaction(() => {
    GALLERY.forEach((p, pi) => {
      const pid = insP.run(p.title, p.year, p.description, p.layout, pi + 1).lastInsertRowid;
      let firstMediaId = null;
      (p.media || []).forEach((m, mi) => {
        const id = insM.run(pid, m.type, m.full || '', m.preview || '', m.aspect || '', m.alt || '', mi + 1).lastInsertRowid;
        if (mi === 0) firstMediaId = id;
      });
      if (firstMediaId) setThumb.run(firstMediaId, pid);
      (p.downloads || []).forEach((d, di) => insD.run(pid, d.label, d.file, d.kind, d.bytes, di + 1));
    });
  });
  run();
  // eslint-disable-next-line no-console
  console.log('[seed] gallery seeded (' + GALLERY.length + ' projects).');
}

// Backfill any settings key that doesn't exist yet, without touching values the
// owner has already changed. Runs on every boot so new settings added in later
// versions appear in existing databases.
function ensureSettingsDefaults(db) {
  const ins = db.prepare('INSERT OR IGNORE INTO site_settings (key, value) VALUES (?, ?)');
  db.transaction(() => {
    Object.entries(SETTINGS).forEach(([k, v]) => ins.run(k, v));
  })();
}

// Same idea for text blocks: add any block that doesn't exist yet, without
// overwriting wording the owner has already changed.
function ensureContentDefaults(db) {
  const ins = db.prepare(
    'INSERT OR IGNORE INTO content_blocks (block_key, grp, label, value, format, sort) VALUES (?,?,?,?,?,?)'
  );
  db.transaction(() => {
    CONTENT.forEach((row, i) => ins.run(row[0], row[1], row[2], row[3], row[4], i + 1));
  })();
}

module.exports = { seedIfEmpty, seedProjectsIfEmpty, ensureSettingsDefaults, ensureContentDefaults };
