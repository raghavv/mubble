package `in`.mubble.android.ui.permission

import android.Manifest
import android.Manifest.permission.*
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.support.v4.app.ActivityCompat
import android.support.v4.content.ContextCompat
import java.util.*

/**
 * Created by siddharthgarg
 * on 30/11/17
 */
enum class PermissionGroup constructor(val group: String, val reqCode: Int, val groupPermissions: Array<String>) {

  STORAGE("android.permission-group.STORAGE", 0, arrayOf(WRITE_EXTERNAL_STORAGE, READ_EXTERNAL_STORAGE)),

  LOCATION("android.permission-group.LOCATION", 1, arrayOf(ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION)),

  CAMERA("android.permission-group.CAMERA", 2, arrayOf(Manifest.permission.CAMERA)),

  SMS("android.permission-group.SMS", 3, arrayOf(SEND_SMS, RECEIVE_SMS, READ_SMS)),

  CONTACTS("android.permission-group.CONTACTS", 4, arrayOf(READ_CONTACTS, WRITE_CONTACTS, GET_ACCOUNTS));

  fun hasPermission(context: Context): Boolean {

    for (perm in groupPermissions) {
      val permStatus = ContextCompat.checkSelfPermission(context, perm)
      if (permStatus != PackageManager.PERMISSION_GRANTED) return false
    }

    return true
  }

  fun shouldShowRationale(activity: Activity): Boolean {

    for (perm in groupPermissions) {
      if (ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)) return true
    }

    return false
  }

  override fun toString(): String {

    return name
  }

  companion object {

    fun getByRequestCode(reqCode: Int): PermissionGroup {

      for (group in values()) {
        if (group.reqCode == reqCode) return group
      }

      throw IllegalArgumentException("reqCode not present:" + reqCode)
    }

    fun getGroup(perm: String): PermissionGroup? {

      for (permissionGroup in values()) {
        val perms = Arrays.asList(*permissionGroup.groupPermissions)
        if (perms.contains(perm)) return permissionGroup
      }

      return null
    }
  }
}