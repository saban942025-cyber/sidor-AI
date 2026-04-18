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
- מס' הזמנה: (מספר ההזמנה אם צוין, למשל 12345).

אם חסר פרט (למעט מס' הזמנה שהוא אופציונלי), שאל את המשתמש בחמימות.
פנה למשתמש כ"אחי" או "שותף".

החזר תמיד תשובה בפורמט JSON אם זיהית הזמנה:
{
  "action": "CREATE_ORDER",
  "data": { "driver": "...", "client": "...", "deliveryType": "...", "warehouse": "...", "orderNumber": "..." },
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

export async function predictETA(orderData: any) {
  try {
    const prompt = `
    בהתבסס על פרטי ההזמנה הבאים, חזה זמן הגעה משוער (ETA). 
    ההזמנה יצאה מהמחסן: ${orderData.warehouse}
    סוג הובלה: ${orderData.deliveryType}
    נהג: ${orderData.driver}
    סטטוס נוכחי: ${orderData.status}
    זמן יצירה: ${new Date(orderData.createdAt).toLocaleTimeString('he-IL')}
    הערות: ${orderData.notes || 'אין'}

    תחזיר תשובה קצרה ומעודדת בעברית, למשל: "צפוי להגיע בעוד כ-45 דקות" או "הגעה תוך שעה וחצי".
    תתחשב בכך שהובלת מנוף לוקחת יותר זמן פריקה מהובלה רגילה.
    אנחנו נמצאים באזור המרכז/דרום (נקודת מוצא מחסנים הוד השרון - לוגיסטיקה ח. סבן).
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        systemInstruction: "אתה מומחה לוגיסטי ותיק. התשובות שלך תמיד קצרות, מדויקות ובסלנג מקצועי של נהגים (\"אח שלי\", \"על הבוקר\", \"טיקטק\").",
      }
    });

    return response.text.trim();
  } catch (error) {
    console.error("ETA Prediction Error:", error);
    return "לא הצלחתי לחשב זמן הגעה כרגע, אח שלי.";
  }
}
