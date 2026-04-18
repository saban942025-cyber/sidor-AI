import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const noaSystemInstruction = `
אתה נועה, המוח הלוגיסטי של "ח. סבן חומרי בניין". תפקידך לספק ממשק ניהול חד, מהיר ואינטואיטיבי למובייל.
סגנון תקשורת: מקצועי, ענייני, "אח ושותף".

ניהול הזמנה חדשה (CREATE_ORDER):
כאשר המשתמש מבקש "הזמנה חדשה" או נותן פרטי הזמנה, חלץ את הפרטים הבאים:
- נהג: (חכמת/עלי).
- לקוח: (למשל: זבולון-עדירן).
- סוג הובלה: (למשל: הובלת מנוף).
- מחסן: (התלמיד/החרש).
- מס' הזמנה: (מספר ההזמנה אם צוין).
- תאריך אספקה: (פורמט YYYY-MM-DD).
- שעת אספקה: (פורמט HH:MM).
- עדיפות: (normal/high).

בדיקת זמן הגעה משוער (GET_ETA):
חלץ לקוח ומספר הזמנה.

החזר תמיד תשובה בפורמט JSON:
עבור CREATE_ORDER:
{
  "action": "CREATE_ORDER",
  "data": { ... },
  "message": "אח שלי, ההזמנה של [לקוח] בלוח. TL;DR: [נהג], [סוג הובלה]. ✅"
}

כללים לשיחה:
1. ניהול שיחה תמציתי.
2. RTL תמיד.
3. סיום ב-TL;DR אם התשובה ארוכה ממשפט אחד.
`;

export async function processNoaMessage(prompt: string, history: any[] = []) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: noaSystemInstruction,
        responseMimeType: "application/json"
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Noa AI Error:", error);
    return { action: "NONE", message: "אח שלי, יש לי תקלה קטנה, תנסה שוב. TL;DR: תקלה. ❌" };
  }
}

export async function predictETA(orderData: any, locationContext: string = "", historicalContext: string = "") {
  try {
    const prompt = `
    חיזוי ETA עבור נועה לוגיסטיקה.
    מיקום נוכחי של הנהג (Geolocation): ${locationContext || 'לא ידוע'}
    מחסן מוצא: ${orderData.warehouse} (התלמיד 6 / החרש 10 הוד השרון)
    לקוח: ${orderData.client}
    סוג הובלה: ${orderData.deliveryType}
    
    ${historicalContext ? `היסטוריה: ${historicalContext}` : ''}

    תחזיר JSON:
    {
      "etaText": "קצר וענייני, למשל: מגיע ב-10:30. TL;DR: עוד 20 דק'.",
      "estimatedMinutes": 20
    }
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "את בתור נועה, מומחית לוגיסטיקה. עניינית, חדה, סלנג מקצועי. תמיד TL;DR בסוף.",
        responseMimeType: "application/json",
        tools: [{ googleSearch: {} }],
        toolConfig: { includeServerSideToolInvocations: true }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("ETA Prediction Error:", error);
    return { etaText: "לא הצלחתי לחשב, אחי. TL;DR: שגיאה.", estimatedMinutes: 0 };
  }
}
