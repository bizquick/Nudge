-- TEST DATA: 20 sample nudges from "Addly Bot", each sent to the owner account and to Alison.
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.
-- * They're dated a few minutes to a few days ago, so no notifications go out.
-- * Addly Bot is marked as accepted for both of you, so they skip the request step.
-- * To remove them all later: delete from reminders where sender = 'Addly Bot';

do $$
declare
  me text;
  who text;
  item jsonb;
  i int := 0;
  items jsonb := '[
    {"title":"This dog learned to skateboard","content":"You need to see the ending","type":"video","url":"https://www.youtube.com/watch?v=dQw4w9WgXcQ","preview":"https://picsum.photos/id/237/1000/600","hours":0.2},
    {"title":"New album you will love","content":"Track 3 is the one","type":"music","url":"https://open.spotify.com/album/4yP0hdKOZPNshxUOjY0cZj","hours":1},
    {"title":"Best smash burgers at home","content":"Making these Friday?","type":"food","url":"https://www.seriouseats.com/ultra-smashed-cheeseburger-recipe-food-lab","preview":"https://picsum.photos/id/1080/1000/600","hours":2},
    {"title":"Do we need this?! A robot vacuum that mops","content":"It empties itself...","type":"unnecessary","url":"https://www.amazon.com/dp/B0CHX3QBCH","hours":3,"priority":true},
    {"title":"The octopus has nine brains","content":"Mind blown","type":"interesting","url":"https://en.wikipedia.org/wiki/Octopus","preview":"https://picsum.photos/id/1069/1000/600","hours":5},
    {"title":"Fold a fitted sheet in 30 seconds","content":"Finally","type":"lifehack","url":"https://www.wikihow.com/Fold-a-Fitted-Sheet","hours":7},
    {"title":"Weekend errands","content":"","type":null,"todo":["Groceries","Car wash","Return the package","Pick up dry cleaning"],"hours":8},
    {"title":"Sunset from the hike","content":"Wish you were here","type":null,"photo":"https://picsum.photos/id/1015/1200/800","hours":10},
    {"title":"This trailer looks so good","content":"Opening night?","type":"video","url":"https://www.youtube.com/watch?v=YoHD9XEInc0","hours":14},
    {"title":"Podcast episode about sleep","content":"Changed how I think about naps","type":"music","url":"https://podcasts.apple.com/us/podcast/huberman-lab/id1545953110","hours":20},
    {"title":"Tacos al pastor recipe","content":"","type":"food","url":"https://www.allrecipes.com/recipe/228295/tacos-al-pastor/","preview":"https://picsum.photos/id/292/1000/600","hours":26},
    {"title":"Call me when you get a sec","content":"Nothing urgent, just catching up","type":"text","hours":30},
    {"title":"Packing list for the beach trip","content":"","type":null,"todo":["Sunscreen","Towels","Speaker","Snacks","Chairs"],"hours":34,"priority":true},
    {"title":"Desk setup inspiration","content":"Thoughts on the lamp?","type":"website","url":"https://www.reddit.com/r/battlestations/","preview":"https://picsum.photos/id/0/1000/600","hours":40},
    {"title":"Cool article on city design","content":"Read the part about trees","type":"website","url":"https://www.theatlantic.com/","hours":46},
    {"title":"How to keep basil alive","content":"RIP my last one","type":"lifehack","url":"https://www.thekitchn.com/how-to-keep-basil-fresh-22950813","hours":52},
    {"title":"Live version of our song","content":"","type":"music","url":"https://soundcloud.com/discover","hours":58},
    {"title":"Do we need this?! Heated socks","content":"Winter is coming","type":"unnecessary","url":"https://www.target.com/","hours":64},
    {"title":"Did you know honey never spoils?","content":"3000 year old honey was still edible","type":"interesting","url":"https://www.smithsonianmag.com/science-nature/the-science-behind-honeys-eternal-shelf-life-1218690/","hours":70},
    {"title":"Dinner spot for Saturday","content":"They take reservations at 5","type":"food","url":"https://www.opentable.com/","preview":"https://picsum.photos/id/431/1000/600","hours":76}
  ]'::jsonb;
begin
  select p.display_name into me from app_admins a join profiles p on p.id = a.user_id limit 1;
  if me is null then raise exception 'Could not find the owner account'; end if;

  -- Addly Bot counts as accepted for both of you (so these skip the request step)
  insert into connections (owner_name, other_name, status)
  values (me, 'Addly Bot', 'accepted'), ('Alison', 'Addly Bot', 'accepted')
  on conflict (owner_name, other_name) do update set status = 'accepted';

  foreach who in array array[me, 'Alison'] loop
    i := 0;
    for item in select * from jsonb_array_elements(items) loop
      i := i + 1;
      insert into reminders (
        type, title, content, url, preview_image, sender, recipient, recipients,
        checked_out, archived, favorited, is_public, created_at, prioritized_at, todo_items, attachments
      ) values (
        item ->> 'type',
        item ->> 'title',
        coalesce(item ->> 'content', ''),
        item ->> 'url',
        coalesce(item ->> 'preview', item ->> 'photo'),
        'Addly Bot',
        who,
        array[who],
        false, false, false, false,
        now() - ((item ->> 'hours')::numeric * interval '1 hour') - interval '5 minutes',
        case when (item ->> 'priority')::boolean then now() - ((item ->> 'hours')::numeric * interval '1 hour') end,
        case when item ? 'todo' then (
          select jsonb_agg(jsonb_build_object('id', gen_random_uuid()::text, 'text', t, 'done', false))
          from jsonb_array_elements_text(item -> 'todo') t
        ) end,
        case when item ? 'photo' then jsonb_build_array(jsonb_build_object('url', item ->> 'photo', 'name', 'Sunset.jpg', 'type', 'image/jpeg')) end
      );
    end loop;
  end loop;
end
$$;

-- Proof it worked: should show 2 rows of 20
select recipient as sent_to, count(*) as nudges
from reminders where sender = 'Addly Bot'
group by recipient;
