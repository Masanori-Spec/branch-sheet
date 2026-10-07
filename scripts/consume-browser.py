"""Open the actual browser downloads in disposable native Calc; never user inputs."""
import copy, hashlib, importlib.util, json, os, pathlib, subprocess, time, uuid
import uno
from com.sun.star.beans import PropertyValue
from com.sun.star.document.MacroExecMode import NEVER_EXECUTE
from com.sun.star.document.UpdateDocMode import NO_UPDATE
ROOT=pathlib.Path(__file__).resolve().parents[1]; OUT=ROOT/'evidence'; DOWNLOADS=OUT/'browser-downloads'; WORK=ROOT/'.native'
spec=importlib.util.spec_from_file_location('literal_oracle',ROOT/'scripts/calc-native.py'); oracle=importlib.util.module_from_spec(spec);spec.loader.exec_module(oracle)
def props(**values):
    result=[]
    for name,value in values.items():
        item=PropertyValue();item.Name=name;item.Value=value;result.append(item)
    return tuple(result)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def command(*args):return subprocess.run(args,cwd=ROOT,capture_output=True,text=True,check=True,timeout=30).stdout

def main():
    assert os.environ.get('GITHUB_ACTIONS')=='true' and os.environ.get('DISPLAY'),'Hosted synthetic-download gate only'
    ids=json.loads((OUT/'freeplane-result.json').read_text())['ids']
    required=['initial.xlsx','refreshed.xlsx','repeated.xlsx','filtered-scope.xlsx','unchanged.xlsx','restored.xlsx','scale-refreshed.xlsx','review.json']
    assert set(p.name for p in DOWNLOADS.iterdir())==set(required)
    for name in required:
        assert (DOWNLOADS/name).is_file() and not (DOWNLOADS/name).is_symlink() and (DOWNLOADS/name).stat().st_size<16*1024*1024
    for name,reference in [('initial.xlsx','initial.xlsx'),('refreshed.xlsx','refreshed.xlsx'),('repeated.xlsx','refreshed.xlsx'),('filtered-scope.xlsx','refreshed.xlsx'),('unchanged.xlsx','refreshed.xlsx'),('restored.xlsx','restored.xlsx'),('scale-refreshed.xlsx','scale-refreshed.xlsx')]:
        assert (DOWNLOADS/name).read_bytes()==(OUT/reference).read_bytes(),name+' differs from its exact CLI consumer baseline'
    receipt=json.loads((DOWNLOADS/'review.json').read_text());assert receipt['mapSHA256']==sha(OUT/'updated.mm') and receipt['priorSHA256']==sha(OUT/'calc-annotated.xlsx') and receipt['workbookSHA256']==sha(DOWNLOADS/'refreshed.xlsx')
    profile=WORK/'browser-calc-profile';profile.mkdir(exist_ok=True);pipe='branchsheet_browser_'+uuid.uuid4().hex
    log=(OUT/'browser-calc.log').open('w');process=subprocess.Popen(['libreoffice','-env:UserInstallation='+profile.as_uri(),'--norestore','--nodefault','--nologo','--nofirststartwizard','--accept=pipe,name='+pipe+';urp;StarOffice.ComponentContext'],stdout=log,stderr=subprocess.STDOUT)
    local=uno.getComponentContext();resolver=local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver',local);context=None;end=time.monotonic()+60
    while context is None and time.monotonic()<end:
        try:context=resolver.resolve('uno:pipe,name='+pipe+';urp;StarOffice.ComponentContext')
        except Exception:time.sleep(.3)
    assert context is not None
    desktop=context.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop',context);documents=[]
    def load(name,hidden=False):
        document=desktop.loadComponentFromURL((DOWNLOADS/name).as_uri(),'_blank',0,props(Hidden=hidden,MacroExecutionMode=NEVER_EXECUTE,UpdateDocMode=NO_UPDATE,ReadOnly=True));assert document and document.supportsService('com.sun.star.sheet.SpreadsheetDocument');documents.append(document);return document
    def close(document):document.close(True);documents.remove(document)
    def capture(document):
        assert list(document.Sheets.getElementNames())==['Active','Removed','_BranchSheet'];result={}
        for name in ['Active','Removed']:
            sheet=document.Sheets.getByName(name);cursor=sheet.createCursor();cursor.gotoEndOfUsedArea(False);end=cursor.RangeAddress.EndRow;assert end<40002
            assert [sheet.getCellByPosition(c,0).getString() for c in range(9)]==oracle.HEADERS;rows=[]
            for r in range(1,end+1):
                cells=[sheet.getCellByPosition(c,r) for c in range(9)]
                if not any(c.getString() for c in cells):continue
                values=[c.getValue() if cindex in (3,4) else c.getString() for cindex,c in enumerate(cells)];types=[c.getType().value for c in cells]
                for i,(value,kind) in enumerate(zip(values,types)):
                    if i in (3,4):assert kind=='VALUE' and value==int(value)
                    else:assert kind=='TEXT' if value else kind in ('EMPTY','TEXT')
                rows.append({'row':r+1,'values':values,'types':types})
            result[name]=rows
        return result
    def check(record,state,blank=False):
        expected=oracle.expected(ids,state)
        if blank:
            for row in expected['Active']:row[6:]=['','','']
        for name in expected:assert [r['values'] for r in record[name]]==expected[name],name
    def screenshot(name,document,sheet='Active'):
        controller=document.getCurrentController();target=document.Sheets.getByName(sheet);controller.setActiveSheet(target);controller.setPropertyValue('ZoomValue',70)
        controller.select(target.getCellRangeByName('G1:I6' if sheet=='Active' else 'A1:I2'))
        windows=command('xdotool','search','--onlyvisible','--class','libreoffice').split();assert windows
        command('xdotool','windowsize',windows[-1],'1500','920');command('xdotool','windowactivate','--sync',windows[-1]);time.sleep(.5);command('scrot',str(OUT/name))
    records={}
    try:
        for name,state,blank in [('initial.xlsx','before',True),('refreshed.xlsx','updated',False),('restored.xlsx','restored',False)]:
            document=load(name);record=capture(document);check(record,state,blank);records[name]=record
            if name=='refreshed.xlsx':
                height=document.Sheets.getByName('Active').getRows().getByIndex(5).getPropertyValue('Height');assert height>=1400,'Multiline row remains too short'
                screenshot('browser-calc-refreshed-active.png',document);screenshot('browser-calc-refreshed-removed.png',document,'Removed')
            close(document)
        # Literal fidelity corruption controls operate on the actual native readings.
        controls=[]
        for name in ['changed-parent','swapped-annotations','corrupt-annotation']:
            actual=copy.deepcopy(records['refreshed.xlsx']);x=next(r for r in actual['Active'] if r['values'][0]==ids['X']);y=actual['Removed'][0]
            if name=='changed-parent':x['values'][2]=ids['A']
            elif name=='swapped-annotations':x['values'][6:],y['values'][6:]=y['values'][6:],x['values'][6:]
            else:x['values'][6]='CORRUPTED'
            try:check(actual,'updated')
            except AssertionError:pass
            else:raise AssertionError('Native literal oracle missed control')
            controls.append({'name':name,'kind':'in-memory one-field negative control of actual native readings','mutatedNativeRecord':actual,'rejected':True})
        started=time.monotonic();document=load('scale-refreshed.xlsx',hidden=True);scale=capture(document);close(document)
        active=[r['values'][0] for r in scale['Active']];removed=[r['values'][0] for r in scale['Removed']]
        expected_active={'SCALE_ROOT'}|{f'G{i}' for i in range(99)}|{f'N{i}' for i in range(100,19900)}|{f'NEW{i}' for i in range(100)}
        assert len(active)==len(set(active))==20000 and set(active)==expected_active
        assert len(removed)==len(set(removed))==100 and set(removed)=={f'N{i}' for i in range(100)}
        for row in scale['Active']+scale['Removed']:
            node=row['values'][0];annotations=['','',''] if node.startswith('NEW') else [f'007-{node}',f'First line for {node}\nSecond line 日本語','=literal owner'];assert row['values'][6:]==annotations
        print_reports=[]
        for name in ['one-row-preview','review-ja','review-en']:
            pdfs=list((ROOT/'test-results').rglob(name+'.pdf'));assert len(pdfs)==1
            pdf_info=command('pdfinfo',str(pdfs[0]));pages=int(next(line.split(':',1)[1].strip() for line in pdf_info.splitlines() if line.startswith('Pages:')))
            assert pages==1 if name=='one-row-preview' else 1<=pages<=3
            pdf_text=command('pdftotext','-layout',str(pdfs[0]),'-')
            if name=='one-row-preview':assert 'N99' in pdf_text and '007-N99' in pdf_text and 'N100' not in pdf_text
            else:
                for marker in ['Catalog','Beta','ID_1000004','ID_1000005','007','line1','line2','=1+1','日本語']:assert marker in pdf_text,(name,marker)
            (OUT/(name+'-text.txt')).write_text(pdf_text)
            command('pdftoppm','-scale-to','1800','-png',str(pdfs[0]),str(OUT/name))
            images=sorted(OUT.glob(name+'-*.png'));assert len(images)==pages
            print_reports.append({'name':name,'pages':pages,'pdfSHA256':sha(pdfs[0]),'pageImages':[p.name for p in images]})
        report={'printPreviews':print_reports,'scope':'Actual single-file offline browser downloads reopened by native Calc. Fixed synthetic inputs only; no formula evaluation. Native producer and six native-edited workbook fault controls ran separately in this same commit.','libreOfficeVersion':command('libreoffice','--version').strip(),'downloadSHA256':{n:sha(DOWNLOADS/n) for n in required},'records':records,'multilineRowHeightHundredthMillimetres':height,'literalOracleControls':controls,'scale':{'active':20000,'removed':100,'annotationStringsChecked':60300,'exactUniqueIdSetsChecked':True,'reopenAndCheckSeconds':round(time.monotonic()-started,3),'activeIdSetSHA256':hashlib.sha256('\n'.join(sorted(active)).encode()).hexdigest(),'removedIdSetSHA256':hashlib.sha256('\n'.join(sorted(removed)).encode()).hexdigest()}}
        (OUT/'browser-native-result.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    finally:
        for document in list(documents):
            try:close(document)
            except Exception:pass
        desktop.terminate()
        try:assert process.wait(timeout=15)==0
        except subprocess.TimeoutExpired:process.terminate();raise
        log.close()
if __name__=='__main__':main()
