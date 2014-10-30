var path = require('path')
  , moment = require('moment')
  , crypto = require('crypto')
  , xml2js = require('xml2js')
  , sprintf = require('sprintf-js').sprintf
  , soap = require('soap');
  ;
var parser = new xml2js.Parser();


exports.client = null;


exports.initialize = function(settings, callback) {
  // TODO: Handle different locations of where the asmx lives.
  var endpoint = 'https://' + path.join(settings.url, 'EWS/Exchange.asmx');
  var url = path.join(__dirname, 'Services.wsdl');

  soap.createClient(url, {}, function(err, client) {
    if (err) {
      return callback(err);
    }
    if (!client) {
      return callback(new Error('Could not create client'));
    }

    exports.client = client;
    exports.client.setSecurity(new soap.BasicAuthSecurity(settings.username, settings.password));

    return callback(null);
  }, endpoint);
}


exports.getEmails = function(folderName, limit, callback) {
  if (typeof(folderName) === "function") {
    callback = folderName;
    folderName = 'inbox';
    limit = 10;
  }
  if (typeof(limit) === "function") {
    callback = limit;
    limit = 10;
  }
  if (!exports.client) {
    return callback(new Error('Call initialize()'));
  }

  var soapRequest = 
    '<tns:FindItem Traversal="Shallow" xmlns:tns="http://schemas.microsoft.com/exchange/services/2006/messages">' +
      '<tns:ItemShape>' +
        '<t:BaseShape>IdOnly</t:BaseShape>' +
        '<t:AdditionalProperties>' +
          '<t:FieldURI FieldURI="item:ItemId"></t:FieldURI>' +
          // '<t:FieldURI FieldURI="item:ConversationId"></t:FieldURI>' +
          // '<t:FieldURI FieldURI="message:ReplyTo"></t:FieldURI>' +
          // '<t:FieldURI FieldURI="message:ToRecipients"></t:FieldURI>' +
          // '<t:FieldURI FieldURI="message:CcRecipients"></t:FieldURI>' +
          // '<t:FieldURI FieldURI="message:BccRecipients"></t:FieldURI>' +
          '<t:FieldURI FieldURI="item:DateTimeCreated"></t:FieldURI>' +
          '<t:FieldURI FieldURI="item:DateTimeSent"></t:FieldURI>' +
          '<t:FieldURI FieldURI="item:HasAttachments"></t:FieldURI>' +
          '<t:FieldURI FieldURI="item:Size"></t:FieldURI>' +
          '<t:FieldURI FieldURI="message:From"></t:FieldURI>' +
          '<t:FieldURI FieldURI="message:IsRead"></t:FieldURI>' +
          '<t:FieldURI FieldURI="item:Importance"></t:FieldURI>' +
          '<t:FieldURI FieldURI="item:Subject"></t:FieldURI>' +
          '<t:FieldURI FieldURI="item:DateTimeReceived"></t:FieldURI>' +
        '</t:AdditionalProperties>' + 
      '</tns:ItemShape>' +
      '<tns:IndexedPageItemView BasePoint="Beginning" Offset="0" MaxEntriesReturned="10"></tns:IndexedPageItemView>' +
      '<tns:ParentFolderIds>' + 
        '<t:DistinguishedFolderId Id="inbox"></t:DistinguishedFolderId>' + 
      '</tns:ParentFolderIds>' + 
    '</tns:FindItem>';

  exports.client.FindItem(soapRequest, function(err, result, body) {
    if (err) {
      return callback(err);
    }


    parser.parseString(body, function(err, result) {

      var responseCode = '';
      var rootFolder = '';
      if (result['soap:Envelope'] !== undefined) {
        result = result['soap:Envelope'];
      }
      else if (result['s:Envelope'] !== undefined) {
        result = result['s:Envelope'];
      }

      if (result['s:Body'] !== undefined) {
        responseCode = result['s:Body']['m:FindItemResponse']['m:ResponseMessages']['m:FindItemResponseMessage']['m:ResponseCode'];
        if (responseCode !== 'NoError') {
          return callback(new Error(responseCode));
        }
          
        rootFolder = result['s:Body']['m:FindItemResponse']['m:ResponseMessages']['m:FindItemResponseMessage']['m:RootFolder'];
      }
      else {
        responseCode = result['soap:Body']['m:FindItemResponse']['m:ResponseMessages']['m:FindItemResponseMessage']['m:ResponseCode'];
        if (responseCode !== 'NoError') {
          return callback(new Error(responseCode));
        }
          
        rootFolder = result['soap:Body']['m:FindItemResponse']['m:ResponseMessages']['m:FindItemResponseMessage']['m:RootFolder'];
      }

      var emails = [];
      rootFolder['t:Items']['t:Message'].forEach(function(item, idx) {
        var md5hasher = crypto.createHash('md5');
        md5hasher.update(item['t:Subject'] + item['t:DateTimeSent']);
        var hash = md5hasher.digest('hex');

        var itemId = {
          id: item['t:ItemId']['@'].Id,
          changeKey: item['t:ItemId']['@'].ChangeKey
        };

        var dateTimeReceived = item['t:DateTimeReceived'];

        emails.push({
          id: itemId.id + '|' + itemId.changeKey,
          hash: hash,
          subject: item['t:Subject'],
          dateTimeReceived: moment(dateTimeReceived).format("MM/DD/YYYY, h:mm:ss A"),
          size: item['t:Size'],
          importance: item['t:Importance'],
          hasAttachments: (item['t:HasAttachments'] === 'true'),
          from: item['t:From']['t:Mailbox']['t:Name'],
          isRead: (item['t:IsRead'] === 'true'),
          meta: {
            itemId: itemId
          }
        });
      });

      callback(null, emails);
    });
  });
}

exports.getAttachmentIds = function (emailId, callback) {
  var request =
    '<tns:GetItem>\
      <tns:ItemShape>\
        <t:BaseShape>IdOnly</t:BaseShape>\
        <t:AdditionalProperties>\
          <t:FieldURI FieldURI="item:Attachments" />\
        </t:AdditionalProperties>\
      </tns:ItemShape>\
      <tns:ItemIds>\
        <t:ItemId Id="%s" ChangeKey="%s" />\
      </tns:ItemIds>\
    </tns:GetItem>';
  var id = emailId.split('|')[0];
  var changeKey = emailId.split('|')[1];
  var soapRequest = sprintf(request, id, changeKey);
  exports.client.GetItem(soapRequest, function (err, result, body) {
    if (err) { return callback(err); }

    var responseCode = result.ResponseMessages.GetItemResponseMessage.ResponseCode;
    if (responseCode !== 'NoError') {
      return callback(new Error(responseCode));
    }
    var parser = new xml2js.Parser();
    parser.parseString(body, function(error, xml) {
      if (error) { return callback(error); }
      var response = '';
      if (result['soap:Envelope'] !== undefined) {
        result = result['soap:Envelope'];
      }
      else if (result['s:Envelope'] !== undefined) {
        result = result['s:Envelope'];
      }

      if (xml['s:Body'] !== undefined) {
        response = xml['s:Body']['m:GetItemResponse']['m:ResponseMessages']['m:GetItemResponseMessage']['m:Items']['t:Message'];
      }
      else {
        var response = xml['soap:Body']['m:GetItemResponse']['m:ResponseMessages']['m:GetItemResponseMessage']['m:Items']['t:Message'];
      }
      var returnValues = [];
      if (typeof(response) === Array) {
        response.foreach(function(item, idx) {
          var attachmentId = item['t:ItemId']['Id'];
          var attachmentChangeKey = item['t:ItemId']['ChangeKey'];
          returnValues.push(attachmentId + '|' + attachmentChangeKey);
        });
      }
      else {
        var attachmentId = response['t:ItemId']['@'].Id;
        var attachmentChangeKey = response['t:ItemId']['@'].ChangeKey;
        returnValues.push(attachmentId + '|' + attachmentChangeKey);
      }
      return callback(returnValues);
    });
  });
};

exports.getAttachmentById = function (attachmentId, callback) {
  var request = 
    '<tns:GetAttachment>\
      <tns:AttachmentIds>\
        <t:AttachmentId Id="%s" ChangeKey="%s" />\
      </tns:AttachmentIds>\
    </tns:GetAttachment>';
  var id = attachmentId.split('|')[0];
  var changeKey = attachmentId.split('|')[1];
  var soapRequest = sprintf(request, id, changeKey);
  exports.client.GetItem(soapRequest, function (err, result, body) {
    if (err) { return callback(err); }

    var responseCode = result.ResponseMessages.GetItemResponseMessage.ResponseCode;
    if (responseCode !== 'NoError') {
      return callback(new Error(responseCode));
    }

    parser.parseString(body, function(error, xml) {
      if (error) { return callback(error); }
      if (xml['soap:Envelope'] !== undefined) {
        xml = xml['soap:Envelope'];
      }
      else if (xml['s:Envelope'] !== undefined) {
        xml = xml['s:Envelope'];
      }

      if (xml['s:Body'] !== undefined) {
        var content = xml['s:Body']['m:GetAttachmentResponse']['m:ResponseMessages']['m:GetAttachmentResponseMessage']['m:Attachments']['t:FileAttachment']['t:Content'];
        var name = xml['s:Body']['m:GetAttachmentResponse']['m:ResponseMessages']['m:GetAttachmentResponseMessage']['m:Attachments']['t:FileAttachment']['t:Name'];
      }
      else {
        var content = xml['soap:Body']['m:GetAttachmentResponse']['m:ResponseMessages']['m:GetAttachmentResponseMessage']['m:Attachments']['t:FileAttachment']['t:Content'];
        var name = xml['soap:Body']['m:GetAttachmentResponse']['m:ResponseMessages']['m:GetAttachmentResponseMessage']['m:Attachments']['t:FileAttachment']['t:Name'];
      }
      callback(null, { Name: name, Content: content });
    });
  });
};


exports.getEmail = function(itemId, callback) {
  if (!exports.client) {
    return callback(new Error('Call initialize()'))
  }
  if ((!itemId['id'] || !itemId['changeKey']) && itemId.indexOf('|') > 0) {
    var s = itemId.split('|');

    itemId = {
      id: itemId.split('|')[0],
      changeKey: itemId.split('|')[1]
    };
  }

  if (!itemId.id || !itemId.changeKey) {
    return callback(new Error('Id is not correct.'));
  }

  var soapRequest = 
    '<tns:GetItem xmlns="http://schemas.microsoft.com/exchange/services/2006/messages" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types">' +
      '<tns:ItemShape>' +
        '<t:BaseShape>Default</t:BaseShape>' +
        '<t:IncludeMimeContent>true</t:IncludeMimeContent>' +
      '</tns:ItemShape>' +
      '<tns:ItemIds>' +
        '<t:ItemId Id="' + itemId.id + '" ChangeKey="' + itemId.changeKey + '" />' +
      '</tns:ItemIds>' +
    '</tns:GetItem>';

  exports.client.GetItem(soapRequest, function(err, result, body) {
    if (err) {
      return callback(err);
    }

    var parser = new xml2js.Parser();

    parser.parseString(body, function(err, result) {
      var responseCode = '';
      var item = '';
      if (result['soap:Envelope'] !== undefined) {
        result = result['soap:Envelope'];
      }
      else if (result['s:Envelope'] !== undefined) {
        result = result['s:Envelope'];
      }
      
      if (result['s:Body'] !== undefined) {
        responseCode = result['s:Body']['m:GetItemResponse']['m:ResponseMessages']['m:GetItemResponseMessage']['m:ResponseCode'];

        if (responseCode !== 'NoError') {
          return callback(new Error(responseCode));
        }
         
        item = result['s:Body']['m:GetItemResponse']['m:ResponseMessages']['m:GetItemResponseMessage']['m:Items']['t:Message'];
      }
      else {
        responseCode = result['soap:Body']['m:GetItemResponse']['m:ResponseMessages']['m:GetItemResponseMessage']['m:ResponseCode'];

        if (responseCode !== 'NoError') {
          return callback(new Error(responseCode));
        }
         
        item = result['soap:Body']['m:GetItemResponse']['m:ResponseMessages']['m:GetItemResponseMessage']['m:Items']['t:Message'];
      }

      var itemId = {
        id: item['t:ItemId']['@'].Id,
        changeKey: item['t:ItemId']['@'].ChangeKey
      };

      function handleMailbox(mailbox) {
        var mailboxes = [];

        if (!mailbox || !mailbox['t:Mailbox']) {
          return mailboxes;
        }
        mailbox = mailbox['t:Mailbox'];

        function getMailboxObj(mailboxItem) {
          return {
            name: mailboxItem['t:Name'],
            emailAddress: mailboxItem['t:EmailAddress']
          };
        }

        if (mailbox instanceof Array) {
          mailbox.forEach(function(m, idx) {
            mailboxes.push(getMailboxObj(m));
          })
        } else {
          mailboxes.push(getMailboxObj(mailbox));
        }

        return mailboxes;
      }

      var toRecipients = handleMailbox(item['t:ToRecipients']);
      var ccRecipients = handleMailbox(item['t:CcRecipients']);
      var from = handleMailbox(item['t:From']);

      var email = {
        id: itemId.id + '|' + itemId.changeKey,
        subject: item['t:Subject'],
        bodyType: item['t:Body']['@']['t:BodyType'],
        body: item['t:Body']['#'],
        size: item['t:Size'],
        dateTimeSent: item['t:DateTimeSent'],
        dateTimeCreated: item['t:DateTimeCreated'],
        toRecipients: toRecipients,
        ccRecipients: ccRecipients,
        from: from,
        isRead: (item['t:IsRead'] == 'true') ? true : false,
        meta: {
          itemId: itemId
        }
      };

      callback(null, email);
    });
  });
}


exports.getFolders = function(id, callback) {
  if (typeof(id) == 'function') {
    callback = id;
    id = 'inbox';
  }

  var soapRequest = 
    '<tns:FindFolder xmlns:tns="http://schemas.microsoft.com/exchange/services/2006/messages">' +
        '<tns:FolderShape>' +
          '<t:BaseShape>Default</t:BaseShape>' +
        '</tns:FolderShape>' +
        '<tns:ParentFolderIds>' + 
          '<t:DistinguishedFolderId Id="inbox"></t:DistinguishedFolderId>' + 
        '</tns:ParentFolderIds>' + 
      '</tns:FindFolder>';

  exports.client.FindFolder(soapRequest, function(err, result) {
    if (err) {
      callback(err)
    }
    
    if (result.ResponseMessages.FindFolderResponseMessage.ResponseCode == 'NoError') {
      var rootFolder = result.ResponseMessages.FindFolderResponseMessage.RootFolder;
      
      rootFolder.Folders.Folder.forEach(function(folder) {
        // console.log(folder);
      });

      callback(null, {});
    }
  });
}