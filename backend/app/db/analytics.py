"""
Analytics views for PostgreSQL.
Called from app lifespan after ALTER TABLE migrations.
"""

from sqlalchemy import text


_VIEWS_SQL = [
    # 1. Piano ammortamento con anno e stato
    """
    CREATE OR REPLACE VIEW v_piano_annuale AS
    SELECT
        m.id AS mutuo_id,
        m.nome AS mutuo_nome,
        m.banca,
        EXTRACT(YEAR FROM pa.data_scadenza)::INTEGER AS anno,
        EXTRACT(MONTH FROM pa.data_scadenza)::INTEGER AS mese,
        pa.numero_rata,
        pa.data_scadenza,
        pa.quota_capitale,
        pa.quota_interessi,
        pa.rata_totale,
        pa.pagata,
        pa.capitale_residuo_dopo
    FROM piano_ammortamento pa
    JOIN mutui m ON m.id = pa.mutuo_id
    WHERE m.attivo = TRUE
    """,

    # 2. Riepilogo annuale per mutuo
    """
    CREATE OR REPLACE VIEW v_mutuo_annuale AS
    SELECT
        mutuo_id,
        mutuo_nome,
        banca,
        anno,
        SUM(quota_capitale)   AS tot_capitale,
        SUM(quota_interessi)  AS tot_interessi,
        SUM(rata_totale)      AS tot_rate,
        COUNT(*)              AS n_rate,
        COUNT(*) FILTER (WHERE pagata) AS n_pagate,
        MIN(capitale_residuo_dopo) FILTER (WHERE capitale_residuo_dopo IS NOT NULL) AS cap_residuo_fine_anno
    FROM v_piano_annuale
    GROUP BY mutuo_id, mutuo_nome, banca, anno
    ORDER BY mutuo_id, anno
    """,

    # 3. Riepilogo totale mutui (capitale residuo live)
    """
    CREATE OR REPLACE VIEW v_mutuo_riepilogo AS
    SELECT
        m.id,
        m.nome,
        m.banca,
        m.numero_contratto,
        m.capitale_erogato,
        m.rata_mensile,
        m.rate_totali,
        m.data_erogazione,
        m.data_scadenza,
        COALESCE(SUM(pa.quota_capitale) FILTER (WHERE pa.data_scadenza <= CURRENT_DATE), 0) AS capitale_rimborsato,
        m.capitale_erogato - COALESCE(SUM(pa.quota_capitale) FILTER (WHERE pa.data_scadenza <= CURRENT_DATE), 0) AS capitale_residuo_live,
        COALESCE(SUM(pa.quota_interessi) FILTER (WHERE pa.data_scadenza <= CURRENT_DATE), 0) AS interessi_pagati,
        COALESCE(SUM(pa.quota_interessi) FILTER (WHERE pa.data_scadenza > CURRENT_DATE), 0) AS interessi_residui,
        COUNT(pa.id) FILTER (WHERE pa.data_scadenza <= CURRENT_DATE) AS rate_pagate_live
    FROM mutui m
    LEFT JOIN piano_ammortamento pa ON pa.mutuo_id = m.id
    WHERE m.attivo = TRUE
    GROUP BY m.id, m.nome, m.banca, m.numero_contratto, m.capitale_erogato,
             m.rata_mensile, m.rate_totali, m.data_erogazione, m.data_scadenza
    """,

    # 4. Movimenti per categoria e mese
    """
    CREATE OR REPLACE VIEW v_spese_mensili AS
    SELECT
        TO_CHAR(mv.data_operazione, 'YYYY-MM') AS mese,
        EXTRACT(YEAR FROM mv.data_operazione)::INTEGER AS anno,
        EXTRACT(MONTH FROM mv.data_operazione)::INTEGER AS mese_num,
        cs.nome AS categoria,
        cs.colore,
        mv.tipo::TEXT AS tipo,
        mv.is_carta_credito,
        COUNT(*) AS n_movimenti,
        SUM(ABS(mv.importo)) AS totale,
        AVG(ABS(mv.importo)) AS media
    FROM movimenti mv
    LEFT JOIN categorie_spese cs ON cs.id = mv.categoria_id
    GROUP BY TO_CHAR(mv.data_operazione, 'YYYY-MM'),
             EXTRACT(YEAR FROM mv.data_operazione),
             EXTRACT(MONTH FROM mv.data_operazione),
             cs.nome, cs.colore, mv.tipo, mv.is_carta_credito
    ORDER BY mese DESC, totale DESC
    """,

    # 5. Flusso di cassa mensile
    """
    CREATE OR REPLACE VIEW v_flusso_cassa AS
    SELECT
        TO_CHAR(data_operazione, 'YYYY-MM') AS mese,
        EXTRACT(YEAR FROM data_operazione)::INTEGER AS anno,
        EXTRACT(MONTH FROM data_operazione)::INTEGER AS mese_num,
        SUM(importo) FILTER (WHERE tipo = 'entrata'::tipomovimento) AS entrate,
        SUM(ABS(importo)) FILTER (WHERE tipo = 'uscita'::tipomovimento AND NOT is_carta_credito) AS uscite_conto,
        SUM(ABS(importo)) FILTER (WHERE tipo = 'uscita'::tipomovimento AND is_carta_credito) AS uscite_carta,
        SUM(ABS(importo)) FILTER (WHERE tipo = 'uscita'::tipomovimento) AS uscite_totali,
        SUM(importo) AS saldo_netto,
        COUNT(*) AS n_movimenti
    FROM movimenti
    GROUP BY TO_CHAR(data_operazione, 'YYYY-MM'),
             EXTRACT(YEAR FROM data_operazione),
             EXTRACT(MONTH FROM data_operazione)
    ORDER BY mese DESC
    """,

    # 6. Patrimonio live (snapshot calcolato al volo)
    """
    CREATE OR REPLACE VIEW v_patrimonio_live AS
    SELECT
        'saldo_cc' AS componente,
        COALESCE((
            SELECT SUM(ss.saldo) FROM saldi_snapshot ss
            JOIN conti c ON c.id = ss.conto_id
            WHERE c.tipo = 'conto_corrente'::tipoconto AND c.attivo = TRUE
            AND c.tipo = 'conto_corrente'::tipoconto
            AND ss.id = (SELECT MAX(ss2.id) FROM saldi_snapshot ss2 WHERE ss2.conto_id = c.id)
        ), 0) AS valore
    UNION ALL
    SELECT 'portafoglio_fineco', COALESCE((
        SELECT SUM(ps.valore_mercato) FROM posizioni_snapshot ps
        JOIN posizioni p ON p.id = ps.posizione_id
        WHERE p.piattaforma = 'fineco'::piattaformaenum AND p.attivo = TRUE
        AND ps.id = (SELECT MAX(ps2.id) FROM posizioni_snapshot ps2 WHERE ps2.posizione_id = p.id)
    ), 0)
    UNION ALL
    SELECT 'totale_mutui', COALESCE((
        SELECT SUM(m.capitale_erogato - COALESCE(rp.cap_rimborsato, 0))
        FROM mutui m
        LEFT JOIN (
            SELECT mutuo_id, SUM(quota_capitale) AS cap_rimborsato
            FROM piano_ammortamento WHERE data_scadenza <= CURRENT_DATE
            GROUP BY mutuo_id
        ) rp ON rp.mutuo_id = m.id
        WHERE m.attivo = TRUE
    ), 0)
    """,
]


async def create_analytics_views(conn) -> None:
    """Create or replace all analytics views. Safe to call on every startup."""
    for sql in _VIEWS_SQL:
        await conn.execute(text(sql))
