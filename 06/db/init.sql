CREATE TABLE IF NOT EXISTS deploy_notes (
  id bigserial PRIMARY KEY,
  author text NOT NULL DEFAULT '匿名',
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deploy_notes_created_at_idx
  ON deploy_notes (created_at DESC);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  value bigint NOT NULL DEFAULT 0 CHECK (value >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO counters (name, value)
VALUES ('dashboard_views', 0)
ON CONFLICT (name) DO NOTHING;

INSERT INTO deploy_notes (author, body)
VALUES
  ('nginx', '反向代理已啟動：對外只開放 8080，將請求轉給 Node web 與 Python stats。'),
  ('postgres', 'pgdata volume 已掛載，重啟容器後筆記與瀏覽次數仍會保留。'),
  ('python', 'stats 服務使用 Python 標準庫，回報 hostname、uptime 與 request 次數。')
ON CONFLICT DO NOTHING;
