import base64, json, re, sys, urllib.request, http.cookiejar
from datetime import datetime, timezone

BASE = "https://chs.dhbvn.org.in"
H = {"content-type": "application/json", "appsavylogin": "IG7gR27IJYSa+a/dym3wpw==",
     "formid": "TYDUFR2Pc592nssOkzMrLQ==", "roleid": "KnSKi2BRa296VND7xI1XWQ==",
     "version": "1", "token": "Wwzpa2LygAJqAK1uM94i8A==", "sourcetype": "tzoukK4N1FBlaVGohFL/oQ=="}
XML = ('<?xml version="1.0"?><Request VERSION="2" LANGUAGE_ID="1" LOCATION=""><Company Company_Id="93" />'
       '<Project Project_Id="304" /><User User_Id="Anonymous" /><IUVLogin IUVLogin_Id="Anonymous" />'
       '<ROLE ROLE_ID="1595" /><Event Control_Id="130404" /><Child Control_Id="125681" Report="HTML" AC_ID="163944">'
       '<Parent Control_Id="130402" Value="10" Data_Form_Id="" XValue="10" YValue="" ZValue=""/></Child></Request>')

def iso(s):  # "24-Oct-2026 17:24:39" (IST) -> "2026-10-24T17:24:39+05:30"
    try: return datetime.strptime(s, "%d-%b-%Y %H:%M:%S").strftime("%Y-%m-%dT%H:%M:%S+05:30")
    except ValueError: return ""

op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
op.open(f"{BASE}/ui/anonymous?PROJECTID=304&FORMID=11996", timeout=30).read()
body = json.dumps({"inputxml": base64.b64encode(XML.encode()).decode(), "DocVersion": 1}).encode()
xml = op.open(urllib.request.Request(f"{BASE}/api/AppsavyServices/GetRelationalDataA", body, H), timeout=30).read().decode()
tag = lambda r, n: (re.search(f"<{n}>(.*?)</{n}>", r, re.S) or [None, ""])[1].strip()
rows = [{"feeder": tag(r, "FEEDER"), "area": tag(r, "AREA"), "start": iso(tag(r, "START_TIME")),
         "restoration": iso(tag(r, "EXPECTED_RESTORATION_TIME")), "reason": tag(r, "ADDRESS")}
        for r in re.findall(r"<Rowset>(.*?)</Rowset>", xml, re.S)]
if "<RESULT" not in xml: sys.exit("Unexpected DHBVN response: " + xml[:200])
doc = {"district": "Faridabad", "fetchedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "rows": rows}
json.dump(doc, open(sys.argv[1] if len(sys.argv) > 1 else "outages.json", "w"))
print(len(rows), "rows")
