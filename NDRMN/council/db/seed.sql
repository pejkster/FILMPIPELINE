-- 8 topics, slugs matching {{TOPIC_NAME}} usage in the prompt templates
INSERT INTO topics (id, slug, name) VALUES
    (1, 'work_purpose',          'Work & Purpose'),
    (2, 'health_longevity',      'Health & Longevity'),
    (3, 'family_relationships',  'Family & Relationships'),
    (4, 'learning_growing_up',   'Learning & Growing Up'),
    (5, 'governance_trust',      'Governance & Trust'),
    (6, 'resources_environment', 'Resources & Environment'),
    (7, 'culture_meaning',       'Culture & Meaning'),
    (8, 'ordinary_day',          'The Ordinary Day');

-- 6 council seats
INSERT INTO models (id, lab, name, openrouter_id) VALUES
    (1, 'Anthropic', 'Claude Opus 4.8',       'anthropic/claude-opus-4.8'),
    (2, 'OpenAI',    'GPT-5.6 Sol',           'openai/gpt-5.6-sol'),
    (3, 'Google',    'Gemini 3.1 Pro Preview','google/gemini-3.1-pro-preview'),
    (4, 'xAI',       'Grok 4.5',              'x-ai/grok-4.5'),
    (5, 'Alibaba',   'Qwen3.7 Max',           'qwen/qwen3.7-max'),
    (6, 'DeepSeek',  'DeepSeek V4 Pro',       'deepseek/deepseek-v4-pro');
