CREATE SCHEMA app;
REVOKE ALL ON SCHEMA app FROM PUBLIC;

DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='lifeinbox_app') THEN
        CREATE ROLE lifeinbox_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
    END IF;
END $$;

CREATE TABLE app.users (
    id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    display_name varchar(100) NOT NULL DEFAULT '',
    timezone varchar(64) NOT NULL DEFAULT 'Asia/Seoul',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.spaces (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name varchar(100) NOT NULL,
    type varchar(20) NOT NULL CHECK(type IN ('personal','group')),
    owner_id uuid NOT NULL REFERENCES app.users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_personal_owner ON app.spaces(owner_id) WHERE type='personal';
CREATE INDEX ix_spaces_owner ON app.spaces(owner_id);
CREATE TABLE app.space_members (
    space_id uuid REFERENCES app.spaces(id) ON DELETE CASCADE,
    user_id uuid REFERENCES app.users(id) ON DELETE CASCADE,
    role varchar(20) NOT NULL CHECK(role IN ('owner','member','viewer')),
    joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(space_id,user_id)
);
CREATE INDEX ix_members_user ON app.space_members(user_id);
CREATE TABLE app.items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    space_id uuid NOT NULL REFERENCES app.spaces(id) ON DELETE CASCADE,
    creator_id uuid NOT NULL REFERENCES app.users(id), assignee_id uuid,
    title varchar(200) NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 200),
    description text NOT NULL DEFAULT '', type varchar(32) NOT NULL DEFAULT 'other',
    status varchar(20) NOT NULL DEFAULT 'inbox' CHECK(status IN ('inbox','todo','in_progress','completed','archived')),
    deadline date, start_datetime timestamptz, end_datetime timestamptz,
    amount numeric(14,2) CHECK(amount >= 0),
    currency varchar(3) NOT NULL DEFAULT 'KRW' CHECK(currency IN ('KRW','USD','JPY','EUR','GBP','CNY')),
    source_type varchar(32) NOT NULL DEFAULT 'manual', source_text text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
    FOREIGN KEY(space_id,assignee_id) REFERENCES app.space_members(space_id,user_id),
    CHECK(end_datetime IS NULL OR (start_datetime IS NOT NULL AND end_datetime > start_datetime)),
    CHECK(amount IS NULL OR currency NOT IN ('KRW','JPY') OR amount=trunc(amount))
);
CREATE INDEX ix_items_status_deadline ON app.items(space_id,status,deadline);
CREATE INDEX ix_items_start ON app.items(space_id,start_datetime);
CREATE INDEX ix_items_creator ON app.items(creator_id);
CREATE INDEX ix_items_assignee ON app.items(space_id,assignee_id);
CREATE TABLE app.item_updates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES app.items(id) ON DELETE CASCADE,
    user_id uuid REFERENCES app.users(id) ON DELETE SET NULL, type varchar(32) NOT NULL, content text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_updates_item ON app.item_updates(item_id,created_at);
CREATE INDEX ix_updates_user ON app.item_updates(user_id);
CREATE TABLE app.attachments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), item_id uuid NOT NULL REFERENCES app.items(id) ON DELETE CASCADE,
    uploaded_by uuid REFERENCES app.users(id) ON DELETE SET NULL,
    file_name varchar(255) NOT NULL, mime_type varchar(128) NOT NULL,
    size_bytes bigint NOT NULL CHECK(size_bytes>=0), storage_bucket varchar(100) NOT NULL, storage_path text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(storage_bucket,storage_path)
);
CREATE INDEX ix_attachments_item ON app.attachments(item_id);
CREATE INDEX ix_attachments_uploaded_by ON app.attachments(uploaded_by);

CREATE FUNCTION app.current_user_id() RETURNS uuid LANGUAGE sql STABLE
SET search_path='' AS $$ SELECT nullif(current_setting('app.user_id',true),'')::uuid $$;
REVOKE ALL ON FUNCTION app.current_user_id() FROM PUBLIC;

ALTER TABLE app.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.space_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.item_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY users_self ON app.users FOR SELECT TO lifeinbox_app USING(id=(SELECT app.current_user_id()));
CREATE POLICY spaces_personal ON app.spaces FOR SELECT TO lifeinbox_app USING(owner_id=(SELECT app.current_user_id()) AND type='personal');
CREATE POLICY members_self ON app.space_members FOR SELECT TO lifeinbox_app USING(user_id=(SELECT app.current_user_id()) AND EXISTS (
    SELECT 1 FROM app.spaces s WHERE s.id=space_id
));
CREATE POLICY items_personal ON app.items TO lifeinbox_app USING(EXISTS (
    SELECT 1 FROM app.spaces s WHERE s.id=space_id
)) WITH CHECK(creator_id=(SELECT app.current_user_id()) AND EXISTS (
    SELECT 1 FROM app.spaces s WHERE s.id=space_id
));
CREATE POLICY updates_personal ON app.item_updates FOR SELECT TO lifeinbox_app USING(EXISTS (
    SELECT 1 FROM app.items i WHERE i.id=item_id
));
CREATE POLICY attachments_personal ON app.attachments FOR SELECT TO lifeinbox_app USING(EXISTS (
    SELECT 1 FROM app.items i WHERE i.id=item_id
));

CREATE FUNCTION app.handle_signup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path='' AS $$
DECLARE personal_id uuid;
BEGIN
    INSERT INTO app.users(id,display_name) VALUES(new.id, left(coalesce(new.raw_user_meta_data->>'display_name',''),100));
    INSERT INTO app.spaces(name,type,owner_id) VALUES('개인 Inbox','personal',new.id) RETURNING id INTO personal_id;
    INSERT INTO app.space_members(space_id,user_id,role) VALUES(personal_id,new.id,'owner');
    RETURN new;
END;
$$;
REVOKE ALL ON FUNCTION app.handle_signup() FROM PUBLIC;
CREATE TRIGGER lifeinbox_signup AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION app.handle_signup();

CREATE FUNCTION app.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN new.updated_at=now(); RETURN new; END;
$$;
CREATE TRIGGER touch_users BEFORE UPDATE ON app.users FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER touch_spaces BEFORE UPDATE ON app.spaces FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
CREATE TRIGGER touch_items BEFORE UPDATE ON app.items FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

GRANT USAGE ON SCHEMA app TO lifeinbox_app;
GRANT EXECUTE ON FUNCTION app.current_user_id() TO lifeinbox_app;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO lifeinbox_app;
GRANT INSERT, UPDATE, DELETE ON app.items TO lifeinbox_app;
