-- [DP] tasks ↔ the owner's DP Microsoft To Do (server/dp-sync.js): marking the CRM task done completes the To Do task.
-- Filled when the task is created from To Do (crm_add_action) or on the first "done", by title / ticket match.
ALTER TABLE action_items ADD COLUMN todo_list_id TEXT;
ALTER TABLE action_items ADD COLUMN todo_task_id TEXT;
