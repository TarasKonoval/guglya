"""Validation numbers for the report.

Usage (from repo root):
  DATABASE_URL=... python backend/scripts/stats.py                         # all time
  DATABASE_URL=... python backend/scripts/stats.py --since 2026-11-17 --until 2026-11-18   # one test round
--since is inclusive, --until exclusive (dates or ISO timestamps, Europe/Kyiv time if no zone given).
"""
import argparse
import os

import psycopg


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="1970-01-01")
    ap.add_argument("--until", default="2100-01-01")
    args = ap.parse_args()

    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        conn.execute("set time zone 'Europe/Kyiv'")
        w = {"since": args.since, "until": args.until}

        def one(sql: str):
            return conn.execute(sql, w).fetchone()[0]

        def rows(sql: str):
            return conn.execute(sql, w).fetchall()

        win = "created_at >= %(since)s::timestamptz and created_at < %(until)s::timestamptz"
        cwin = win.replace("created_at", "c.created_at")
        users = one(f"select count(*) from users where {win}")
        viewers = one(f"select count(distinct user_id) from events where type = 'outfit_view' and {win}")
        clickers = one(f"select count(distinct user_id) from clicks where {win}")
        clicks = one(f"select count(*) from clicks where {win}")
        alt = one(f"select count(*) from clicks where is_alternative and {win}")
        donate = one(f"select count(*) from events where type = 'donate_click' and {win}")
        donors = one(f"select count(distinct user_id) from events where type = 'donate_click' and {win}")
        fb_n, fb_avg = conn.execute(f"select count(*), round(avg(rating), 2) from feedback where {win}", w).fetchone()

        print(f"Window: {args.since} .. {args.until} (Europe/Kyiv)\n")
        print(f"Registered users:              {users}")
        print(f"Users with >=1 outfit view:    {viewers}")
        print(f"Users with >=1 brand click:    {clickers}")
        ctr = f"{clickers / viewers:.0%}" if viewers else "n/a"
        print(f"Click-through (clickers/viewers): {ctr}   (goal >= 10%)")
        print(f"Total brand clicks:            {clicks}")
        if clicks:
            print(f"  on AI alternatives:          {alt} ({alt / clicks:.0%})")
            print(f"  on original outfit items:    {clicks - alt} ({(clicks - alt) / clicks:.0%})")
        print(f"Donate button clicks:          {donate} (by {donors} users)")
        print(f"Feedback entries:              {fb_n}, average rating {fb_avg or 'n/a'}")
        for wb, n in rows(f"select coalesce(would_buy, '—'), count(*) from feedback where {win} group by 1 order by 2 desc"):
            print(f"  would buy = {wb}: {n}")

        print("\nClicks per brand:")
        for name, n in rows(f"""select coalesce(b.name, '(deleted)'), count(*) from clicks c
                                left join products p on p.id = c.product_id left join brands b on b.id = p.brand_id
                                where {cwin} group by 1 order by 2 desc"""):
            print(f"  {n:4}  {name}")
        print("\nClicks per outfit:")
        for title, n in rows(f"""select coalesce(o.title, '(no outfit)'), count(*) from clicks c
                                 left join outfits o on o.id = c.outfit_id where {cwin} group by 1 order by 2 desc"""):
            print(f"  {n:4}  {title}")


if __name__ == "__main__":
    main()
