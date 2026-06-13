"""
News & Mercati endpoint.
Aggrega notizie di finanza personale da feed RSS italiani e internazionali,
e produce un "briefing giornaliero" che incrocia portafoglio + notizie + geopolitica
chiedendo a Claude azioni concrete da valutare.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel
from datetime import datetime, timezone
from typing import Optional
import asyncio
import html
import re

import httpx
import feedparser

from app.db.session import get_db
from app.core.security import get_current_user
from app.api.v1.endpoints.advisor import _build_patrimonio_context, _call_claude, _fmt

router = APIRouter()


# ─── Sorgenti RSS ────────────────────────────────────────────────────────────────
# Mix di fonti italiane e internazionali di finanza/mercati.
FEEDS = [
    # Italiane
    {"id": "sole24ore",   "nome": "Il Sole 24 Ore",  "area": "IT",  "categoria": "Economia e Finanza",
     "url": "https://www.ilsole24ore.com/rss/homepage.xml"},
    {"id": "wallstreetit", "nome": "Wall Street Italia", "area": "IT", "categoria": "Mercati",
     "url": "https://www.wallstreetitalia.com/feed/"},
    {"id": "repubblica_eco", "nome": "Repubblica Economia", "area": "IT", "categoria": "Economia",
     "url": "https://www.repubblica.it/rss/economia/rss2.0.xml"},
    # Internazionali
    {"id": "cnbc",        "nome": "CNBC",            "area": "INT", "categoria": "Top News",
     "url": "https://www.cnbc.com/id/100003114/device/rss/rss.html"},
    {"id": "marketwatch", "nome": "MarketWatch",     "area": "INT", "categoria": "Top Stories",
     "url": "http://feeds.marketwatch.com/marketwatch/topstories/"},
    {"id": "yahoofin",    "nome": "Yahoo Finance",   "area": "INT", "categoria": "News",
     "url": "https://finance.yahoo.com/news/rssindex"},
]

HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; FinanzaApp/1.0; +https://salierno.synology.me)",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}

_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text_in: Optional[str], max_len: int = 280) -> str:
    if not text_in:
        return ""
    t = html.unescape(_TAG_RE.sub("", text_in)).strip()
    t = re.sub(r"\s+", " ", t)
    return t[:max_len] + ("…" if len(t) > max_len else "")


def _entry_ts(entry) -> Optional[str]:
    for key in ("published_parsed", "updated_parsed"):
        val = entry.get(key)
        if val:
            try:
                return datetime(*val[:6], tzinfo=timezone.utc).isoformat()
            except Exception:
                pass
    return None


# ─── Schemi ──────────────────────────────────────────────────────────────────────

class NewsItem(BaseModel):
    fonte: str
    area: str
    categoria: str
    titolo: str
    sommario: str
    link: str
    pubblicato: Optional[str] = None


class NewsResponse(BaseModel):
    items: list[NewsItem]
    aggiornato: str
    n_fonti_ok: int
    n_fonti_errore: int


class BriefingAction(BaseModel):
    titolo: str
    dettaglio: str
    urgenza: str          # "alta" | "media" | "bassa"
    tipo: str             # "comprare" | "vendere" | "monitorare" | "ribilanciare" | "informarsi"


class BriefingResponse(BaseModel):
    data: str
    sentiment: str        # "positivo" | "neutro" | "negativo"
    sintesi: str
    rischi_geopolitici: list[str]
    impatto_portafoglio: str
    azioni: list[BriefingAction]
    fonti_usate: list[str]


# ─── Fetch RSS ─────────────────────────────────────────────────────────────────────

async def _fetch_feed(client: httpx.AsyncClient, feed: dict, per_feed: int) -> tuple[list[dict], bool]:
    """Scarica e parsa un singolo feed. Ritorna (items, ok)."""
    try:
        resp = await client.get(feed["url"], headers=HEADERS, follow_redirects=True, timeout=12.0)
        if resp.status_code != 200:
            return [], False
        parsed = feedparser.parse(resp.content)
        items = []
        for e in parsed.entries[:per_feed]:
            items.append({
                "fonte": feed["nome"],
                "area": feed["area"],
                "categoria": feed["categoria"],
                "titolo": _clean(e.get("title"), 200),
                "sommario": _clean(e.get("summary") or e.get("description")),
                "link": e.get("link", ""),
                "pubblicato": _entry_ts(e),
            })
        return items, True
    except Exception:
        return [], False


async def _aggrega_news(per_feed: int = 8) -> tuple[list[dict], int, int]:
    async with httpx.AsyncClient() as client:
        results = await asyncio.gather(
            *[_fetch_feed(client, f, per_feed) for f in FEEDS],
            return_exceptions=True,
        )

    all_items: list[dict] = []
    ok = err = 0
    for r in results:
        if isinstance(r, Exception):
            err += 1
            continue
        items, success = r
        if success:
            ok += 1
            all_items.extend(items)
        else:
            err += 1

    # Ordina per data discendente (gli item senza data finiscono in coda)
    all_items.sort(key=lambda x: x.get("pubblicato") or "", reverse=True)
    return all_items, ok, err


# ─── Endpoints ──────────────────────────────────────────────────────────────────────

@router.get("/", response_model=NewsResponse)
async def get_news(current_user=Depends(get_current_user)):
    """Aggrega le ultime notizie di finanza dai feed configurati (IT + INT)."""
    items, ok, err = await _aggrega_news(per_feed=8)
    return NewsResponse(
        items=[NewsItem(**i) for i in items],
        aggiornato=datetime.now(timezone.utc).isoformat(),
        n_fonti_ok=ok,
        n_fonti_errore=err,
    )


@router.post("/daily-briefing", response_model=BriefingResponse)
async def daily_briefing(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    """
    Briefing giornaliero: incrocia il portafoglio dell'utente con le notizie di mercato
    e il contesto geopolitico, e propone azioni concrete da valutare oggi.
    """
    # 1. Notizie recenti (top 30 per il prompt)
    items, ok, err = await _aggrega_news(per_feed=10)
    if not items:
        raise HTTPException(503, "Nessuna fonte di notizie raggiungibile al momento.")
    top_news = items[:30]

    # 2. Contesto portafoglio
    pat = await _build_patrimonio_context(db, current_user.id)
    portafoglio = pat["portafoglio_items"]

    # 3. Costruzione prompt
    holdings_lines = []
    for p in portafoglio:
        holdings_lines.append(
            f"- {p['simbolo']} ({p['nome']}, {p['tipo']}): valore {_fmt(p['valore_mercato'])}, "
            f"P&L {p['pnl_pct']:+.1f}%"
        )
    holdings_str = "\n".join(holdings_lines) if holdings_lines else "Nessuna posizione in portafoglio."

    news_lines = []
    for n in top_news:
        news_lines.append(f"[{n['area']} · {n['fonte']}] {n['titolo']}" + (f" — {n['sommario'][:120]}" if n['sommario'] else ""))
    news_str = "\n".join(news_lines)

    fonti_usate = sorted({n["fonte"] for n in top_news})

    system = (
        "Sei un analista finanziario senior. Analizzi notizie di mercato e contesto geopolitico "
        "in relazione al portafoglio specifico di un cliente e proponi azioni concrete e prudenti. "
        "Rispondi SEMPRE in italiano. Non dai consigli di investimento personalizzati garantiti: "
        "proponi spunti da valutare, sempre con prudenza e diversificazione. Sii concreto e usa i simboli reali."
    )

    prompt = f"""## PORTAFOGLIO DEL CLIENTE
{holdings_str}

Patrimonio investito totale: {_fmt(pat['portafoglio_totale'])}
Liquidità disponibile: {_fmt(pat['liquidita'])}

## NOTIZIE DI MERCATO DI OGGI (fonti italiane e internazionali)
{news_str}

## RICHIESTA
Analizza le notizie e il quadro geopolitico ODIERNO in relazione a QUESTO portafoglio.
Rispondi SOLO con un JSON valido con questa struttura esatta:
{{
  "sentiment": "<positivo|neutro|negativo>",
  "sintesi": "2-3 frasi sul clima di mercato di oggi e cosa significa per questo portafoglio",
  "rischi_geopolitici": ["rischio geopolitico concreto 1", "rischio 2", ...],
  "impatto_portafoglio": "Paragrafo su come le notizie odierne impattano le posizioni specifiche del cliente (cita i simboli)",
  "azioni": [
    {{"titolo": "azione breve", "dettaglio": "spiegazione concreta", "urgenza": "<alta|media|bassa>", "tipo": "<comprare|vendere|monitorare|ribilanciare|informarsi>"}}
  ]
}}
Fornisci 3-6 azioni concrete prioritizzate per urgenza. Rispondi SOLO con il JSON, senza testo prima o dopo."""

    text = await _call_claude(system=system, messages=[{"role": "user", "content": prompt}], max_tokens=2048)

    # Strip eventuali fence markdown
    if "```" in text:
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else parts[0]
        if text.startswith("json"):
            text = text[4:]

    import json
    try:
        data = json.loads(text.strip())
    except Exception:
        raise HTTPException(502, "Risposta AI non interpretabile. Riprova.")

    azioni = [
        BriefingAction(
            titolo=a.get("titolo", ""),
            dettaglio=a.get("dettaglio", ""),
            urgenza=a.get("urgenza", "media"),
            tipo=a.get("tipo", "monitorare"),
        )
        for a in data.get("azioni", [])
    ]

    return BriefingResponse(
        data=datetime.now(timezone.utc).strftime("%d/%m/%Y"),
        sentiment=data.get("sentiment", "neutro"),
        sintesi=data.get("sintesi", ""),
        rischi_geopolitici=data.get("rischi_geopolitici", []),
        impatto_portafoglio=data.get("impatto_portafoglio", ""),
        azioni=azioni,
        fonti_usate=fonti_usate,
    )
