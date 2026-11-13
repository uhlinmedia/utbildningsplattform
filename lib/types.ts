export type NavMode = 'free' | 'linear' | 'sweep';
export type AccessMode = 'name' | 'name_email' | 'register';

export type QuizOption = { id: string; text: string; correct: boolean };
export type QuizContent = {
  question: string;
  kind: 'single' | 'multi';
  options: QuizOption[];
  explanation?: string;
};
export type TextContent = { markdown: string };
export type TipContent = { text: string };
export type ImageContent = { media_id?: string; alt?: string; caption?: string };
// En videoblock har antingen en Vimeo- eller en YouTube-video. Finns båda används Vimeo.
export type VideoContent = {
  vimeo_id?: string;
  vimeo_hash?: string;
  youtube_id?: string;
  required_percent?: number;
  title?: string;
};
// Bildspel: flera bilder i samma yta med pilar, t.ex. sidor från en PDF eller bilder exporterade från PowerPoint.
// at = tid i sekunder i avsnittets speakerröst då bilden ska visas (bildspelet följer ljudet). Saknas = ingen markering.
export type Slide = { media_id: string; alt?: string; at?: number };
export type SlidesContent = { slides?: Slide[]; title?: string; caption?: string; require_all?: boolean };

export type Block =
  | { id: string; position: number; type: 'text'; content: TextContent }
  | { id: string; position: number; type: 'tip'; content: TipContent }
  | { id: string; position: number; type: 'image'; content: ImageContent }
  | { id: string; position: number; type: 'video'; content: VideoContent }
  | { id: string; position: number; type: 'slides'; content: SlidesContent }
  | { id: string; position: number; type: 'quiz'; content: QuizContent };

// Speakerröst för ett avsnitt. Filen ligger i Supabase Storage (se lib/audio.ts).
// tts = rösten är skapad med AI-uppläsning; text, röst och stil sparas så att den kan skapas om.
export type SectionAudio = {
  path: string; filename: string; mime: string; size: number; duration_s: number | null;
  tts?: { voice: string; style: string; text: string; model: string };
};

export type Section = { id: string; title: string; position: number; audio: SectionAudio | null; blocks: Block[] };
export type Chapter = { id: string; title: string; position: number; sections: Section[] };

export type Course = {
  id: string;
  customer_id: string;
  title: string;
  slug: string;
  description: string;
  access_mode: AccessMode;
  nav_mode: NavMode;
  pass_percent: number;
  max_attempts: number;
  show_answers: boolean;
  audio_autoplay: boolean;
  certificate_enabled: boolean;
  cert_signer: string;
  cert_valid_months: number | null;
  cert_signer_title: string;
  cert_signature_media_id: string | null;
  cert_signer2: string;
  cert_signer2_title: string;
  cert_signature2_media_id: string | null;
  cert_title: string;
  cert_intro: string;
  cert_body: string;
  cert_note: string;
  cert_hidden_badges: string[];
  status: 'draft' | 'published';
  closes_at: string | null;
  preview_token: string | null;
};

export type Customer = {
  id: string;
  name: string;
  color: string;
  logo_media_id: string | null;
  contact_name: string | null;
  contact_email: string | null;
  retention_months: number;
  cert_template: CertTemplate;
  cert_accent: string;
  cert_logo_size: 'S' | 'M' | 'L';
  cert_seal: boolean;
  cert_show_briondo: boolean;
};

export type CertTemplate = 'klassisk' | 'modern' | 'minimal';
export type CertBadge = { id: string; media_id: string; label: string; position: number };
