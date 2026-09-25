# Trade Journal Analytics

Piattaforma **indipendente** (nessun legame con MacroHub Dashboard) per l'analisi completa del tuo journal di trading. Carichi il file del tuo journal — in praticamente qualsiasi formato tabellare — e ottieni dashboard, calendario delle performance e insight generati automaticamente dai tuoi dati.

**Tutto gira nel tuo browser.** Non c'è alcun backend: il file caricato viene letto e analizzato localmente e i trade restano salvati solo nel `localStorage` del tuo dispositivo. Nessun dato viene mai inviato a un server.

## Funzionalità

- **Dashboard**: curva equity, KPI (win rate, profit factor, aspettativa, R:R medio, MAE/MFE medi, drawdown massimo, serie vincenti/perdenti, pips totali), performance per giorno della settimana e per fascia oraria, take profit/stop loss/breakeven, long vs short, confronto mensile.
- **Calendario delle performance**: vista mensile giorno per giorno (con toggle weekend), totale per settimana e per mese, recap settimanale con ultimi trade.
- **Insight automatici** (motore di regole basato sui tuoi dati, nessuna IA esterna coinvolta):
  - Interpretazione generale in linguaggio naturale
  - Consigli personalizzati con priorità, azione consigliata e modo per verificarla
  - Pro e contro
  - Cosa tenere d'occhio
  - Pattern di confluenza (confluenze pro eccellenti / confluenze pericolose)
  - Errori ricorrenti
  - Performance per condizione di mercato e per stato mentale
  - Performance dopo una loss
  - Lettura pattern dalle note del journal (parole ricorrenti nei trade vinti vs persi)
  - Gestione delle pips
- **Registro trade** filtrabile, con possibilità di aggiungere annotazioni manuali (setup, confluenze, errori, stato mentale, qualità di esecuzione, link screenshot) anche dopo l'importazione.
- **Import universale**: CSV, TSV, XLSX/XLS, JSON, con mapping automatico delle colonne (e correzione manuale se necessario) — funziona con l'export di qualsiasi broker o con un foglio personale.
- **PWA installabile**: da smartphone puoi aggiungerla alla schermata Home e usarla come un'app, con funzionamento offline di base sui dati già caricati.

## Perché niente analisi automatica delle immagini

Per gli screenshot dei trade la piattaforma non usa un'IA di visione: puoi collegare un link immagine a ogni trade e annotare manualmente cosa mostra l'esecuzione (setup, confluenze, errori). Le tue annotazioni vengono poi incluse in tutte le statistiche (pattern di confluenza, errori ricorrenti, ecc.).

## Come iniziare

1. Apri `index.html` (o l'URL di deploy) e vai sulla scheda **Carica journal**.
2. Trascina il tuo file oppure scarica il **modello CSV** proposto se non hai ancora un formato.
3. Associa le colonne del tuo file ai campi riconosciuti (fatto automaticamente quando possibile) e conferma l'importazione.
4. Esplora Dashboard, Calendario e Insight. Aggiungi annotazioni ai singoli trade dal Registro per arricchire l'analisi (confluenze, errori, stato mentale, MAE/MFE se non presenti nel file originale).
5. Esporta un backup JSON dei tuoi dati quando vuoi, dalla scheda Carica journal.

## Deploy

È un sito statico puro (nessuna build, nessuna dipendenza server): può essere pubblicato su GitHub Pages, Vercel, Netlify o qualsiasi hosting statico semplicemente servendo la cartella del repository.

## Struttura del progetto

```
index.html          Shell dell'app (tab, modali, markup base)
css/style.css        Tema scuro e stili
js/metrics.js        Calcoli statistici puri (equity, KPI, MAE/MFE, confluenze, ecc.)
js/insights.js       Motore di regole per consigli/pro-contro/interpretazione generale
js/parser.js         Import CSV/TSV/XLSX/JSON + mapping colonne
js/db.js             Persistenza locale (localStorage)
js/calendar.js        Costruzione calendario mensile e recap settimanale
js/charts.js          Rendering grafici (Chart.js)
js/app.js             Controller principale / UI
assets/vendor/        Chart.js e SheetJS vendorizzati (nessuna dipendenza da CDN esterni)
manifest.json, sw.js  Configurazione PWA (installabile, offline sui dati già caricati)
sample/               Journal di esempio per provare subito la piattaforma
```

## Formato dati riconosciuto

Il modello CSV scaricabile dall'app elenca tutte le colonne riconosciute (data, ora, simbolo, direzione, esito, risultato %, pips, R:R pianificato/realizzato, MAE %, MFE %, sessione, condizione di mercato, stato mentale, confluenze, errori, tipo setup, qualità esecuzione, note, link immagine). Solo la colonna **Data** è obbligatoria: più campi compili, più l'analisi sarà approfondita.

## Nota sulla dipendenza XLSX

Per l'import `.xlsx`/`.xls` viene usata la libreria SheetJS (`xlsx` 0.18.5, l'ultima pubblicata su npm). Tale versione ha un advisory noto di prototype-pollution/ReDoS quando analizza file creati ad arte da terzi; qui viene usata solo per leggere file che carichi tu stesso, quindi il rischio pratico è minimo. Se vuoi eliminarlo del tutto, importa i tuoi dati in CSV/JSON invece che in Excel.
