DROP INDEX app.uq_personal_owner;
ALTER TABLE app.spaces ADD COLUMN is_default boolean NOT NULL DEFAULT false;
ALTER TABLE app.spaces DISABLE TRIGGER touch_spaces;
UPDATE app.spaces SET is_default=true WHERE id IN (
    SELECT DISTINCT ON(owner_id) id FROM app.spaces WHERE type='personal' ORDER BY owner_id,created_at,id
);
ALTER TABLE app.spaces DROP CONSTRAINT spaces_type_check;
UPDATE app.spaces SET type='shared' WHERE type='group';
ALTER TABLE app.spaces ADD CONSTRAINT spaces_type_check CHECK(type IN ('personal','shared'));
ALTER TABLE app.spaces ADD CONSTRAINT default_is_personal CHECK(NOT is_default OR type='personal');
CREATE UNIQUE INDEX uq_default_personal_owner ON app.spaces(owner_id) WHERE is_default;
ALTER TABLE app.spaces ADD CONSTRAINT uq_spaces_owner_pair UNIQUE(id,owner_id);
ALTER TABLE app.items ADD CONSTRAINT uq_items_creator_pair UNIQUE(id,creator_id);
ALTER TABLE app.spaces ENABLE TRIGGER touch_spaces;

CREATE FUNCTION app.space_role(target uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='' AS $$
    SELECT CASE WHEN s.owner_id=app.current_user_id() THEN 'owner'
                WHEN s.type='shared' THEN m.role ELSE NULL END
    FROM app.spaces s LEFT JOIN app.space_members m ON m.space_id=s.id AND m.user_id=app.current_user_id()
    WHERE s.id=target
$$;
REVOKE ALL ON FUNCTION app.space_role(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.space_role(uuid) TO lifeinbox_app;

DROP POLICY spaces_personal ON app.spaces;
DROP POLICY members_self ON app.space_members;
DROP POLICY items_personal ON app.items;
CREATE POLICY spaces_visible ON app.spaces FOR SELECT TO lifeinbox_app USING(owner_id=(SELECT app.current_user_id()) OR (type='shared' AND app.space_role(id) IS NOT NULL));
CREATE POLICY spaces_create ON app.spaces FOR INSERT TO lifeinbox_app WITH CHECK(owner_id=(SELECT app.current_user_id()) AND NOT is_default);
CREATE POLICY spaces_edit ON app.spaces FOR UPDATE TO lifeinbox_app USING(owner_id=(SELECT app.current_user_id())) WITH CHECK(owner_id=(SELECT app.current_user_id()));
CREATE POLICY spaces_remove ON app.spaces FOR DELETE TO lifeinbox_app USING(owner_id=(SELECT app.current_user_id()) AND NOT is_default);
CREATE POLICY members_visible ON app.space_members FOR SELECT TO lifeinbox_app USING(app.space_role(space_id) IS NOT NULL);
CREATE POLICY members_create ON app.space_members FOR INSERT TO lifeinbox_app WITH CHECK(app.space_role(space_id)='owner');
CREATE POLICY members_edit ON app.space_members FOR UPDATE TO lifeinbox_app USING(app.space_role(space_id)='owner') WITH CHECK(app.space_role(space_id)='owner');
CREATE POLICY members_remove ON app.space_members FOR DELETE TO lifeinbox_app USING(app.space_role(space_id)='owner' AND role<>'owner');
CREATE POLICY items_visible ON app.items FOR SELECT TO lifeinbox_app USING(app.space_role(space_id) IS NOT NULL);
CREATE POLICY items_create ON app.items FOR INSERT TO lifeinbox_app WITH CHECK(creator_id=(SELECT app.current_user_id()) AND app.space_role(space_id) IN ('owner','member'));
CREATE POLICY items_edit ON app.items FOR UPDATE TO lifeinbox_app USING(app.space_role(space_id) IN ('owner','member')) WITH CHECK(app.space_role(space_id) IN ('owner','member'));
CREATE POLICY items_remove ON app.items FOR DELETE TO lifeinbox_app USING(app.space_role(space_id) IN ('owner','member'));
GRANT INSERT,UPDATE,DELETE ON app.spaces,app.space_members TO lifeinbox_app;

CREATE FUNCTION app.guard_space_member() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s app.spaces; BEGIN
    SELECT * INTO s FROM app.spaces WHERE id=new.space_id;
    IF (s.type='personal' AND new.user_id<>s.owner_id)
       OR (new.role='owner' AND new.user_id<>s.owner_id)
       OR (new.user_id=s.owner_id AND new.role<>'owner') THEN
        RAISE EXCEPTION 'Invalid space membership' USING ERRCODE='23514';
    END IF;
    RETURN new;
END $$;
REVOKE ALL ON FUNCTION app.guard_space_member() FROM PUBLIC;
CREATE TRIGGER guard_space_member BEFORE INSERT OR UPDATE ON app.space_members FOR EACH ROW EXECUTE FUNCTION app.guard_space_member();

CREATE FUNCTION app.guard_default_space() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE owner uuid; BEGIN
    owner=CASE WHEN TG_OP='DELETE' THEN old.owner_id ELSE new.owner_id END;
    IF EXISTS(SELECT 1 FROM app.users WHERE id=owner) AND
       (SELECT count(*) FROM app.spaces WHERE owner_id=owner AND is_default)<>1 THEN
        RAISE EXCEPTION 'One default Personal Space is required' USING ERRCODE='23514';
    END IF;
    RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION app.guard_default_space() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER guard_default_space AFTER INSERT OR UPDATE OR DELETE ON app.spaces
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION app.guard_default_space();

CREATE FUNCTION app.guard_space_identity() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
    IF new.owner_id<>old.owner_id OR new.type<>old.type THEN
        RAISE EXCEPTION 'Space owner and visibility are immutable' USING ERRCODE='23514';
    END IF;
    RETURN new;
END $$;
REVOKE ALL ON FUNCTION app.guard_space_identity() FROM PUBLIC;
CREATE TRIGGER guard_space_identity BEFORE UPDATE ON app.spaces FOR EACH ROW EXECUTE FUNCTION app.guard_space_identity();

CREATE OR REPLACE FUNCTION app.handle_signup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE personal_id uuid; BEGIN
    INSERT INTO app.users(id,display_name) VALUES(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',''),100));
    INSERT INTO app.spaces(name,type,owner_id,is_default) VALUES('개인 Inbox','personal',new.id,true) RETURNING id INTO personal_id;
    INSERT INTO app.space_members(space_id,user_id,role) VALUES(personal_id,new.id,'owner');
    RETURN new;
END $$;
