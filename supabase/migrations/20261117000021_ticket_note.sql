-- 席の特記事項(「パクチー抜き」など)。注文画面で入れ、調理場のカードに出す。
alter table tickets add column if not exists note text not null default '';
