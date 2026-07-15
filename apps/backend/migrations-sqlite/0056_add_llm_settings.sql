-- Add llm_settings column to project table for admin LLM configuration controls
ALTER TABLE project ADD COLUMN llm_settings TEXT NOT NULL DEFAULT '{"disabledProviders":[]}';
