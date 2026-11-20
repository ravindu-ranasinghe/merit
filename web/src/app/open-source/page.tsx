"use client";

import Link from "next/link";
import { useState } from "react";
import { IconArrowRight, IconGithub, IconLock } from "@/components/icons";
import { Empty, LinkButton, Money, Notice, PageHeader, Pill, Skeleton, Tray } from "@/components/ui";
import { useOpenSource } from "@/lib/api/queries";
import { formatDeadline } from "@/lib/format";
import { useNow } from "@/lib/now";

export default function OpenSourcePage() {
  const { data, isLoading, error } = useOpenSource();
  const [search, setSearch] = useState("");
  const [language, setLanguage] = useState("");
  const [sort, setSort] = useState("value");
  const now = useNow();
  const all = (data ?? []).filter((b) => new Date(b.deadline).getTime() > now);
  const languages = [...new Set(all.flatMap((b) => b.language ? [b.language] : []))].sort();
  const query = search.trim().toLowerCase();
  const visible = all.filter((b) => (!language || b.language === language)
    && (!query || `${b.pr.title} ${b.repo.fullName} ${b.repositoryDescription ?? ""}`.toLowerCase().includes(query)))
    .sort((a, b) => sort === "deadline" ? a.deadline.localeCompare(b.deadline)
      : BigInt(a.amountUnits) === BigInt(b.amountUnits) ? a.deadline.localeCompare(b.deadline)
      : BigInt(a.amountUnits) > BigInt(b.amountUnits) ? -1 : 1);
  const total = all.reduce((sum, b) => sum + BigInt(b.amountUnits), BigInt(0));
  return (
    <div className="space-y-4">
      <PageHeader title="Open source, open rewards" lead="Find a pull request that needs a careful pair of eyes. Every reward listed here is already funded."
        action={<LinkButton href="/maintainer/new" variant="secondary">Fund a review</LinkButton>} />
      <Tray tone="white">
        <div className="flex flex-wrap items-center justify-between gap-6">
          <div className="max-w-[55ch]">
            <h2 className="text-[24px] font-medium tracking-tight">A good catch can make someone’s day.</h2>
            <p className="mt-2 text-[14px] text-mut">Review on GitHub. Help the author land a fix. The maintainer decides which review earned the reward.</p>
            <p className="mt-3 flex items-center gap-2 text-[12px] text-good"><IconLock size={13} /> Rewards held in escrow on Arc testnet</p>
          </div>
          <div className="sm:text-right">
            {isLoading ? <Skeleton className="h-12 w-40" /> : <Money units={total} className="text-[36px]" />}
            <p className="mt-1 text-[13px] text-mut">{all.length} open {all.length === 1 ? "bounty" : "bounties"}</p>
          </div>
        </div>
      </Tray>
      <Tray>
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 text-[12px] font-medium text-ink-2">Find a repository or pull request
            <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search open rewards" className="mt-1 block h-10 w-full rounded-ctl border border-line bg-card px-3 text-[14px] font-normal text-ink" />
          </label>
          <label className="text-[12px] font-medium text-ink-2">Language
            <select value={language} onChange={(e) => setLanguage(e.target.value)} className="mt-1 block h-10 rounded-ctl border border-line bg-card px-3 text-[14px] font-normal text-ink"><option value="">All languages</option>{languages.map((l) => <option key={l}>{l}</option>)}</select>
          </label>
          <label className="text-[12px] font-medium text-ink-2">Sort by
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="mt-1 block h-10 rounded-ctl border border-line bg-card px-3 text-[14px] font-normal text-ink"><option value="value">Highest reward</option><option value="deadline">Closing soon</option></select>
          </label>
        </div>
        {isLoading ? <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-32" /></div>
          : error ? <Notice tone="critical" title="Open rewards could not be loaded">{error.message}</Notice>
          : visible.length === 0 ? <Empty title={all.length ? "No rewards match your search" : "The next good catch starts here"} action={<LinkButton href="/maintainer/new" variant="secondary">Fund the first review</LinkButton>}>
            {all.length ? "Try another repository, keyword, or language." : "There are no verified, open rewards right now. Maintainers can fund a bounty on a public pull request."}
          </Empty>
          : <div className="space-y-3">{visible.map((b) => <article key={b.id} className="flex flex-wrap items-center gap-5 rounded-card bg-card p-5 shadow-inner-card">
            <div className="min-w-0 flex-1 basis-80">
              <p className="flex items-center gap-2 break-all text-[12px] text-mut"><IconGithub size={14} className="shrink-0" />{b.repo.fullName} #{b.pr.number}</p>
              <Link href={`/bounties/${b.id}`} className="mt-1 block text-[18px] font-medium leading-snug hover:underline">{b.pr.title}</Link>
              {b.repositoryDescription && <p className="mt-2 line-clamp-2 max-w-[70ch] text-[13px] text-mut">{b.repositoryDescription}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-2"><Pill tone="good"><IconLock size={11} />Funded</Pill>{b.language && <Pill>{b.language}</Pill>}<span className="text-[12px] text-mut">Closes {formatDeadline(b.deadline)}</span></div>
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-5 sm:block sm:text-right"><Money units={b.amountUnits} className="text-[28px]" /><div className="sm:mt-3"><LinkButton href={`/bounties/${b.id}`} variant="secondary">Explore bounty <IconArrowRight size={13} /></LinkButton></div></div>
          </article>)}</div>}
      </Tray>
      <p className="px-1 text-[12px] text-mut">Public repositories only. One bounty pays one reviewer, once. A GitHub approval alone does not qualify a review.</p>
    </div>
  );
}
