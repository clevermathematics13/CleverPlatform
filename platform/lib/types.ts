export type UserRole = "teacher" | "student" | "parent";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
}

export interface Course {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface Student {
  id: string;
  profile_id: string;
  course_id: string;
  parent_code: string;
  created_at: string;
  extra_time: 0 | 25 | 50; // percent extra time for accommodations
}

export interface ParentLink {
  id: string;
  parent_profile_id: string;
  student_id: string;
  created_at: string;
}

export interface RegistrationCode {
  id: string;
  code: string;
  student_id: string;
  used: boolean;
  used_by: string | null;
  created_at: string;
  expires_at: string | null;
}
