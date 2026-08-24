
-- Remove pcleveng@amersol.edu.pe's student enrollment rows (converting to parent role)
delete from students
where profile_id = '44db5d56-f3ab-419f-9238-83377ac05b1d';

-- Convert pcleveng@amersol.edu.pe profile from student to parent
update profiles
set role = 'parent', updated_at = now()
where id = '44db5d56-f3ab-419f-9238-83377ac05b1d';

-- Link parent (pcleveng) to student (Paul Clevenger, enrolled in 9A)
insert into parent_links (parent_profile_id, student_id)
values ('44db5d56-f3ab-419f-9238-83377ac05b1d', 'ad655bf9-6f84-43bd-813d-c0038a46498b');
;
