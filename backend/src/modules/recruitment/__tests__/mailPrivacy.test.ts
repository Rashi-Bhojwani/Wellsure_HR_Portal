import { afterEach, describe, expect, it, vi } from "vitest";
import { ConsoleMailService } from "../../../integrations/mail/ConsoleMailService";
import { SmtpMailService } from "../../../integrations/mail/SmtpMailService";
import { logger } from "../../../lib/logger";
afterEach(()=>vi.restoreAllMocks());
const message={to:'demo.private.candidate@example.invalid',subject:'DEMO PRIVATE SUBJECT',html:'DEMO PRIVATE BODY',text:'DEMO PRIVATE BODY',sensitive:true};
describe("private recruitment transport logs",()=>{
 it("console transport prepares a real local message without logging its recipient, subject or body",async()=>{
 const info=vi.spyOn(logger,'info').mockImplementation(()=>undefined),log=vi.spyOn(console,'log').mockImplementation(()=>undefined);
 const receipt=await new ConsoleMailService().send(message);expect(receipt.delivered).toBe(false);expect(receipt.driver).toBe('console');const output=JSON.stringify([info.mock.calls,log.mock.calls]);for(const value of [message.to,message.subject,message.text])expect(output).not.toContain(value);expect(log).not.toHaveBeenCalled();
 });
 it("SMTP transport also suppresses private metadata while returning its real acceptance receipt",async()=>{
 const info=vi.spyOn(logger,'info').mockImplementation(()=>undefined),service=Object.create(SmtpMailService.prototype) as SmtpMailService;
 Object.defineProperties(service,{from:{value:'demo.sender@example.invalid'},transporter:{value:{sendMail:vi.fn().mockResolvedValue({accepted:[message.to],rejected:[],messageId:'DEMO-MAIL'})}}});
 const receipt=await service.send(message);expect(receipt.delivered).toBe(true);expect(receipt.detail).toBe('DEMO-MAIL');const output=JSON.stringify(info.mock.calls);for(const value of [message.to,message.subject,message.text])expect(output).not.toContain(value);
 });
});
