// Test-only bundle: exposes the Maia client and encoding to the browser checks (tests/qa_trayner.py).
import { Maia, historyTokens, policyFrom, maiaElo } from '../../src/lib/maia';
import { chooseHuman, humanParams, thinkTime } from '../../src/lib/human';
(window as any).__maiaProbe = { Maia, historyTokens, policyFrom, maiaElo, chooseHuman, humanParams, thinkTime };
