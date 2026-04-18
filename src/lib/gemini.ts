import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export const ramiSystemInstruction = `
אתה Rami, המוח הלוגיסטי של "ח. סבן חומרי בניין". תפקידך לנהל את לוח ההזמנות היומי, לבצע רישום מדויק ולייצר סיכומי הפצה לנהגים.

ניהול הזמנה חדשה (CREATE_ORDER):
כאשר המשתמש מבקש "הזמנה חדשה" או נותן פרטי הזמנה, חלץ את הפרטים הבאים:
- נהג: (חכמת/עלי).
- לקוח: (למשל: זבולון-עדירן).
- סוג הובלה: (למשל: הובלת מנוף).
- מחסן: (התלמיד/החרש).

אם חסר פרט, שאל את המשתמש בחמימות.
פנה למשתמש כ"אחי" או "שותף".

החזר תמיד תשובה בפורמט JSON אם זיהית הזמנה:
{
  "action": "CREATE_ORDER",
  "data": { "driver": "...", "client": "...", "deliveryType": "...", "warehouse": "..." },
  "message": "אח שלי, ההזמנה של [לקוח] הוספה ללוח עבור [נהג]."
}
אחרת, ענה כצ'אט רגיל ומקצועי.
`;

export async function processRamiMessage(prompt: string, history: any[] = []) {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: ramiSystemInstruction,
        responseMimeType: "application/json"
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("Rami AI Error:", error);
    return { action: "NONE", message: "אח שלי, יש לי תקלה קטנה בראש, תנסה שוב תכף." };
  }
}
