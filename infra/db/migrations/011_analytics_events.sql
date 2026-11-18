-- Product analytics (19 Nov): more event types, event details, a visitor id for the anonymous part of the
-- sign-up funnel, and where a brand click came from.
alter table events drop constraint if exists events_type_check;
alter table events add constraint events_type_check check (type in (
  'outfit_view', 'swap', 'donate_click', 'feedback_open',
  'outfit_impression', 'reel_dwell',                       -- shown in the feed / time on a reel (meta.ms)
  'cart_add', 'cart_remove', 'save', 'unsave',
  'feed_tab', 'feed_sort', 'feed_color',                   -- meta.value
  'landing_view', 'signup_click', 'signin_click',          -- sign-up funnel
  'signup_submit', 'code_sent', 'code_confirmed', 'signin_done'
));
alter table events
  add column if not exists meta jsonb,
  add column if not exists anon_id text;                    -- random id per browser (localStorage)
create index if not exists events_anon_idx on events (anon_id) where anon_id is not null;
create index if not exists events_outfit_idx on events (outfit_id, type);

alter table clicks
  add column if not exists source text,                     -- card | cart | reel
  add column if not exists anon_id text;
