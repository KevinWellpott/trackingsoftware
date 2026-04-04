export type Workspace = {
  id: string;
  name: string;
  invite_code: string;
  created_at: string;
};

export type WorkspaceMember = {
  workspace_id: string;
  user_id: string;
  role: "owner" | "member";
};

export type Profile = {
  user_id: string;
  username: string;
  created_at: string;
};

export type PitchList = {
  id: string;
  workspace_id: string;
  name: string;
  pitch_text: string | null;
  owner_name: string | null;
  sort_order: number;
  archived_at: string | null;
  created_at: string;
};

export type PipelineStage = {
  id: string;
  list_id: string;
  name: string;
  probability_pct: number | null;
  sort_order: number;
  exclude_from_followup: boolean;
  created_at: string;
};

export type Contact = {
  id: string;
  list_id: string;
  workspace_id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  stage_id: string | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  deal_value: number | null;
  custom_fields: Record<string, unknown>;
  // Neue Felder
  pitched_at: string | null;
  follow_up_number: 1 | 2 | 3 | null;
  answered: boolean | null;
  appointment_set: boolean | null;
  answer_text: string | null;
  answer_category: string | null;
  created_at: string;
  updated_at: string;
};

export type ContactWithStage = Contact & {
  pipeline_stages: PipelineStage | null;
};
