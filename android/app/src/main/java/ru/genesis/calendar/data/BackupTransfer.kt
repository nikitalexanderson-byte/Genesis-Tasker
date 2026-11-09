package ru.genesis.calendar.data

/** UTF-16 positions match JavaScript strings; no filesystem paths or credentials are accepted. */
internal class BackupTransfer(private val maximum:Int=32*1024*1024,private val chunk:Int=131072) {
    private val transfers=mutableMapOf<String,StringBuilder>()
    @Synchronized fun append(id:String,index:Int,last:Boolean,text:String):String? {
        require(id.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))&&index in 0..maximum/chunk&&text.length<=chunk) { "BACKUP_TRANSFER_INVALID" }
        if(index==0){require(id !in transfers && transfers.size<2) { "BACKUP_TRANSFER_BUSY" };transfers[id]=StringBuilder()}
        val buffer=requireNotNull(transfers[id]) { "BACKUP_TRANSFER_ORDER" }
        require(buffer.length==index*chunk&&buffer.length+text.length<=maximum&& (last||text.length==chunk)) { "BACKUP_TRANSFER_ORDER" }
        buffer.append(text)
        return if(last){transfers.remove(id);buffer.toString()}else null
    }
    @Synchronized fun clear(){transfers.clear()}
}
